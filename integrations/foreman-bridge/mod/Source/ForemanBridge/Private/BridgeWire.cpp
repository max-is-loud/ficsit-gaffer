// Protocol v2 wire codec: envelopes, the four producer requests and their
// replies, snapshot preparation and digests. Rows are encoded by
// Wire/RowCodec; JSON primitives live in Wire/JsonFields.
#include "BridgeWire.h"
#include "Wire/JsonFields.h"
#include "Wire/RowCodec.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Misc/Char.h"
// OpenSSL's UI typedef conflicts with Unreal's reflected UI namespace.
#pragma push_macro("UI")
#define UI ForemanOpenSSLUI
THIRD_PARTY_INCLUDES_START
#include <openssl/evp.h>
THIRD_PARTY_INCLUDES_END
#pragma pop_macro("UI")
#include <initializer_list>
#include <limits>

namespace {
using namespace BridgeJson;
using namespace foreman;
// Wire names, indexed by the enum they name.
const char* const EVENT_TYPES[] = {"buildable.upsert", "buildable.remove"};
const char* const ORIGINS[] = {"placed", "reconciled", "reconfigured"};
template <typename Enum, size_t Count>
bool EnumNamed(const char* const (&Names)[Count], const std::string& Name, Enum& Out) {
    for (size_t Index = 0; Index < Count; ++Index) { if (Name == Names[Index]) { Out = static_cast<Enum>(Index); return true; } }
    return false;
}
bool EnvelopeOf(const Object& O,Envelope& E,bool Connected) {
    double Protocol;
    return Number(Field(O,TEXT("protocol")),Protocol)&&Protocol==2&&Id(O,TEXT("serverId"),E.serverId)
        &&Id(O,TEXT("worldId"),E.worldId)&&Id(O,TEXT("epoch"),E.epoch)&&Id(O,TEXT("requestId"),E.requestId)
        &&(!Connected||Id(O,TEXT("connectionId"),E.connectionId));
}
bool ValidRequestInput(const Request& R) {
    const auto& E=R.envelope;
    if(!ValidString(E.serverId)||!ValidString(E.worldId)||!ValidString(E.epoch)||!ValidString(E.requestId)||!ValidString(E.connectionId)) { return false; }
    if(const auto* H=std::get_if<Hello>(&R.body)) {
        const auto& P=H->provenance;
        return ValidString(P.gameVersion)&&ValidString(P.smlVersion)&&ValidString(P.bridgeVersion)&&ValidString(P.starterCommit)&&ValidString(P.bridgeSourceSha256);
    }
    if(const auto* C=std::get_if<SnapshotChunk>(&R.body)) { return ValidString(C->snapshotId)&&ValidString(C->data); }
    if(const auto* C=std::get_if<SnapshotCommit>(&R.body)) { return ValidString(C->snapshotId)&&ValidString(C->sha256); }
    const auto& X=std::get<foreman::Exchange>(R.body);
    if(X.events.size()>Limits::MaxBatchEvents||X.commandResults.size()>Limits::MaxBatchEvents) { return false; }
    for(const auto& EventValue:X.events) { if(!ValidString(EventValue.entityId)||(EventValue.row&&!BridgeRows::ValidRow(*EventValue.row))) { return false; } }
    for(const auto& Result:X.commandResults) { if(!ValidString(Result.commandId)) { return false; } }
    return true;
}
bool EventOf(const Object& O,Event& E) {
    std::string Type,OriginText;
    if(!Text(O,TEXT("type"),Type)||!Text(O,TEXT("origin"),OriginText)||!Seq(O,TEXT("seq"),E.seq,false)||!Id(O,TEXT("entityId"),E.entityId)
        ||!EnumNamed(ORIGINS,OriginText,E.origin)||!EnumNamed(EVENT_TYPES,Type,E.type)) { return false; }
    if(E.type==EventType::Remove) { return Fields(O,{TEXT("seq"),TEXT("type"),TEXT("entityId"),TEXT("origin")}); }
    if(!Fields(O,{TEXT("seq"),TEXT("type"),TEXT("entityId"),TEXT("origin"),TEXT("row")})) { return false; }
    Row R;if(!BridgeRows::RowFromJson(Child(O,TEXT("row")),R)||R.entityId!=E.entityId) { return false; }E.row=std::move(R);return true;
}
bool CommandIdentity(const std::string& IdText,const Envelope& E,std::optional<uint64_t> Causal={}) {
    const std::string Prefix=E.worldId+"/"+E.epoch+"/";
    if(IdText.size()>128||!IdText.starts_with(Prefix)||!IdText.ends_with("/chat")) { return false; }
    uint64_t SeqNumber;
    return SeqText(IdText.substr(Prefix.size(),IdText.size()-Prefix.size()-5),SeqNumber,false)&&(!Causal||SeqNumber==*Causal);
}
bool ChatText(const std::string& TextValue) {
    if(TextValue.empty()||TextValue.size()>Limits::MaxChatBytes) { return false; }
    TArray<uint32> Codes;
    if(!Scalars(TConstArrayView<uint8>(reinterpret_cast<const uint8*>(TextValue.data()),static_cast<int32>(TextValue.size())),&Codes)||Codes.Num()>512) { return false; }
    for(uint32 C:Codes) {
        // Unicode control and format-control ranges, including bidi and tag controls.
        if(C<32||(C>=127&&C<=159)||C=='<'||C=='>'||C==0xad||(C>=0x600&&C<=0x605)||C==0x61c||C==0x6dd||C==0x70f
            ||(C>=0x890&&C<=0x891)||C==0x8e2||C==0x180e||(C>=0x200b&&C<=0x200f)||(C>=0x202a&&C<=0x202e)
            ||(C>=0x2060&&C<=0x2064)||(C>=0x2066&&C<=0x206f)||C==0xfeff||(C>=0xfff9&&C<=0xfffb)||C==0x110bd||C==0x110cd
            ||(C>=0x13430&&C<=0x1343f)||(C>=0x1bca0&&C<=0x1bca3)||(C>=0x1d173&&C<=0x1d17a)||C==0xe0001||(C>=0xe0020&&C<=0xe007f)) { return false; }
    }return true;
}
bool CommandOf(const Object& O,const Envelope& E,Command& C) {
    double Expiry=0;
    if(!Fields(O,{TEXT("commandId"),TEXT("causalSeq"),TEXT("type"),TEXT("text"),TEXT("expiresAt")})
        ||!Seq(O,TEXT("causalSeq"),C.causalSeq,false)||!Text(O,TEXT("commandId"),C.commandId,128)||!CommandIdentity(C.commandId,E,C.causalSeq)
        ||!Text(O,TEXT("type"),C.type)||C.type!="chat.send"||!Text(O,TEXT("text"),C.text,2048)||!ChatText(C.text)
        ||!Number(Field(O,TEXT("expiresAt")),Expiry)||Expiry<0||Expiry>9007199254740991.0||Expiry!=FMath::FloorToDouble(Expiry)) { return false; }
    C.expiresAt=static_cast<int64_t>(Expiry);return true;
}
bool StatusOf(const std::string& S,CommandStatus& Status) {
    if(S=="executed") { Status=CommandStatus::Executed; }else if(S=="skipped") { Status=CommandStatus::Skipped; }
    else if(S=="expired") { Status=CommandStatus::Expired; }else if(S=="rejected") { Status=CommandStatus::Rejected; }else { return false; }return true;
}
const TCHAR* StatusText(CommandStatus Status) {
    switch(Status) { case CommandStatus::Executed:return TEXT("executed");case CommandStatus::Skipped:return TEXT("skipped");
        case CommandStatus::Expired:return TEXT("expired");default:return TEXT("rejected"); }
}
bool ArrayOf(const Object& O,const TCHAR* Key,const TArray<Value>*& Out) {
    auto V=Field(O,Key);if(!V||V->Type!=EJson::Array||V->AsArray().Num()>128) { return false; }Out=&V->AsArray();return true;
}
Object ValueObject(const Value& V) { return V&&V->Type==EJson::Object?V->AsObject():Object{}; }
#define ENV_KEYS TEXT("protocol"),TEXT("serverId"),TEXT("worldId"),TEXT("epoch"),TEXT("requestId")
#define CONNECTED_KEYS ENV_KEYS,TEXT("connectionId")
Object EnvelopeJson(const Envelope& E,bool Connected) {
    auto O=MakeShared<FJsonObject>();O->SetNumberField(TEXT("protocol"),2);Put(O,TEXT("serverId"),E.serverId);Put(O,TEXT("worldId"),E.worldId);
    Put(O,TEXT("epoch"),E.epoch);Put(O,TEXT("requestId"),E.requestId);if(Connected) { Put(O,TEXT("connectionId"),E.connectionId); }return O;
}
}
foreman::RequestKind FBridgeWire::Kind(const std::string& Name) {
    if(Name=="hello") { return RequestKind::Hello; }if(Name=="snapshot/chunk") { return RequestKind::SnapshotChunk; }
    if(Name=="snapshot/commit") { return RequestKind::SnapshotCommit; }if(Name=="exchange") { return RequestKind::Exchange; }return RequestKind::Invalid;
}
TOptional<foreman::Request> FBridgeWire::DecodeRequest(foreman::RequestKind KindValue,TConstArrayView<uint8> Bytes) {
    auto O=Parse(Bytes);Request R;if(!EnvelopeOf(O,R.envelope,KindValue!=RequestKind::Hello)) { return {}; }
    if(KindValue==RequestKind::Hello) {
        Hello H;
        if(!Fields(O,{ENV_KEYS,TEXT("latestSeq"),TEXT("oldestRetainedSeq"),TEXT("provenance")})||!Seq(O,TEXT("latestSeq"),H.latestSeq)
            ||!Seq(O,TEXT("oldestRetainedSeq"),H.oldestRetainedSeq)||H.oldestRetainedSeq>H.latestSeq) { return {}; }
        auto P=Child(O,TEXT("provenance"));
        if(!Fields(P,{TEXT("gameVersion"),TEXT("smlVersion"),TEXT("bridgeVersion"),TEXT("starterCommit"),TEXT("bridgeSourceSha256")})
            ||!Text(P,TEXT("gameVersion"),H.provenance.gameVersion,128)||!Text(P,TEXT("smlVersion"),H.provenance.smlVersion,128)
            ||!Text(P,TEXT("bridgeVersion"),H.provenance.bridgeVersion,128)||!Text(P,TEXT("starterCommit"),H.provenance.starterCommit,40)||!Hex(H.provenance.starterCommit,40)
            ||!Text(P,TEXT("bridgeSourceSha256"),H.provenance.bridgeSourceSha256,64)||!Hex(H.provenance.bridgeSourceSha256,64)) { return {}; }R.body=std::move(H);
    } else if(KindValue==RequestKind::Exchange) {
        foreman::Exchange X;const TArray<Value>* Events;const TArray<Value>* Results;
        if(!Fields(O,{CONNECTED_KEYS,TEXT("events"),TEXT("commandResults")})||!ArrayOf(O,TEXT("events"),Events)||!ArrayOf(O,TEXT("commandResults"),Results)) { return {}; }
        for(const auto& V:*Events) { Event E;if(!EventOf(ValueObject(V),E)) { return {}; }X.events.push_back(std::move(E)); }
        for(const auto& V:*Results) {
            auto Item=ValueObject(V);CommandResult Result;std::string Status;
            if(!Fields(Item,{TEXT("commandId"),TEXT("status")})||!Text(Item,TEXT("commandId"),Result.commandId,128)
                ||!CommandIdentity(Result.commandId,R.envelope)||!Text(Item,TEXT("status"),Status)||!StatusOf(Status,Result.status)) { return {}; }X.commandResults.push_back(std::move(Result));
        }R.body=std::move(X);
    } else if(KindValue==RequestKind::SnapshotChunk) {
        SnapshotChunk C;
        if(!Fields(O,{CONNECTED_KEYS,TEXT("snapshotId"),TEXT("chunkIndex"),TEXT("data")})||!Id(O,TEXT("snapshotId"),C.snapshotId)
            ||!UInt(O,TEXT("chunkIndex"),C.chunkIndex)||!Text(O,TEXT("data"),C.data,Limits::MaxBodyBytes)||C.data.back()!='\n') { return {}; }
        size_t Start=0;std::string Previous;
        while(Start<C.data.size()) {
            const size_t End=C.data.find('\n',Start);const auto Line=C.data.substr(Start,End-Start);Row RowValue;
            if(!BridgeRows::RowFromJson(Parse(TConstArrayView<uint8>(reinterpret_cast<const uint8*>(Line.data()),static_cast<int32>(Line.size()))),RowValue)||RowValue.entityId<=Previous) { return {}; }
            Previous=RowValue.entityId;Start=End+1;
        }R.body=std::move(C);
    } else if(KindValue==RequestKind::SnapshotCommit) {
        SnapshotCommit C;
        if(!Fields(O,{CONNECTED_KEYS,TEXT("snapshotId"),TEXT("watermark"),TEXT("chunkCount"),TEXT("rowCount"),TEXT("sha256")})
            ||!Id(O,TEXT("snapshotId"),C.snapshotId)||!Seq(O,TEXT("watermark"),C.watermark)||!UInt(O,TEXT("chunkCount"),C.chunkCount)
            ||!UInt(O,TEXT("rowCount"),C.rowCount)||!Text(O,TEXT("sha256"),C.sha256,64)||!Hex(C.sha256,64)
            ||((C.chunkCount==0)!=(C.rowCount==0))||C.chunkCount>C.rowCount) { return {}; }
        if(C.rowCount==0&&Wide(C.sha256)!=SnapshotDigest({})) { return {}; }R.body=std::move(C);
    } else { return {}; }return R;
}
TOptional<foreman::Reply> FBridgeWire::DecodeResponse(TConstArrayView<uint8> Bytes,const foreman::ExpectedReply& Expected) {
    auto O=Parse(Bytes);Reply R;
    if(!EnvelopeOf(O,R.envelope,true)||R.envelope.serverId!=Expected.envelope.serverId||R.envelope.worldId!=Expected.envelope.worldId
        ||R.envelope.epoch!=Expected.envelope.epoch||R.envelope.requestId!=Expected.envelope.requestId
        ||(Expected.kind!=RequestKind::Hello&&R.envelope.connectionId!=Expected.envelope.connectionId)) { return {}; }
    if(Expected.kind==RequestKind::Hello) {
        HelloReply H;std::string Mode;if(!Text(O,TEXT("mode"),Mode)) { return {}; }
        if(Mode=="resume") { if(!Fields(O,{CONNECTED_KEYS,TEXT("mode"),TEXT("cursor")})||!Seq(O,TEXT("cursor"),H.cursor)) { return {}; } }
        else if(Mode=="snapshotRequired") { H.snapshotRequired=true;if(!Fields(O,{CONNECTED_KEYS,TEXT("mode"),TEXT("reason")})||!Text(O,TEXT("reason"),H.reason,256)) { return {}; } }
        else { return {}; }R.body=std::move(H);
    } else if(Expected.kind==RequestKind::Exchange) {
        ExchangeReply X;const TArray<Value>* Commands;
        if(!Fields(O,{CONNECTED_KEYS,TEXT("ackSeq"),TEXT("commands")},{TEXT("resyncRequired")})||!Seq(O,TEXT("ackSeq"),X.ackSeq)||!ArrayOf(O,TEXT("commands"),Commands)) { return {}; }
        for(const auto& V:*Commands) { Command C;if(!CommandOf(ValueObject(V),R.envelope,C)) { return {}; }X.commands.push_back(std::move(C)); }
        if(O->HasField(TEXT("resyncRequired"))) { std::string Reason;if(!Text(O,TEXT("resyncRequired"),Reason,256)) { return {}; }X.resyncRequired=std::move(Reason); }R.body=std::move(X);
    } else if(Expected.kind==RequestKind::SnapshotChunk) {
        ChunkReply C;if(!Fields(O,{CONNECTED_KEYS,TEXT("snapshotId"),TEXT("chunkIndex")})||!Id(O,TEXT("snapshotId"),C.snapshotId)||!UInt(O,TEXT("chunkIndex"),C.chunkIndex)) { return {}; }R.body=std::move(C);
    } else if(Expected.kind==RequestKind::SnapshotCommit) {
        SnapshotReply C;if(!Fields(O,{CONNECTED_KEYS,TEXT("snapshotId"),TEXT("watermark")})||!Id(O,TEXT("snapshotId"),C.snapshotId)||!Seq(O,TEXT("watermark"),C.watermark)) { return {}; }R.body=std::move(C);
    } else { return {}; }return R;
}
TArray<uint8> FBridgeWire::EncodeRequest(const foreman::Request& R) {
    if(!ValidRequestInput(R)) { return {}; }
    const bool IsHello=std::holds_alternative<Hello>(R.body);auto O=EnvelopeJson(R.envelope,!IsHello);RequestKind K=RequestKind::Invalid;
    if(const auto* H=std::get_if<Hello>(&R.body)) {
        K=RequestKind::Hello;PutSeq(O,TEXT("latestSeq"),H->latestSeq);PutSeq(O,TEXT("oldestRetainedSeq"),H->oldestRetainedSeq);
        auto P=MakeShared<FJsonObject>();Put(P,TEXT("gameVersion"),H->provenance.gameVersion);Put(P,TEXT("smlVersion"),H->provenance.smlVersion);
        Put(P,TEXT("bridgeVersion"),H->provenance.bridgeVersion);Put(P,TEXT("starterCommit"),H->provenance.starterCommit);Put(P,TEXT("bridgeSourceSha256"),H->provenance.bridgeSourceSha256);O->SetObjectField(TEXT("provenance"),P);
    } else if(const auto* C=std::get_if<SnapshotChunk>(&R.body)) {
        K=RequestKind::SnapshotChunk;Put(O,TEXT("snapshotId"),C->snapshotId);O->SetNumberField(TEXT("chunkIndex"),C->chunkIndex);Put(O,TEXT("data"),C->data);
    } else if(const auto* Commit=std::get_if<SnapshotCommit>(&R.body)) {
        K=RequestKind::SnapshotCommit;Put(O,TEXT("snapshotId"),Commit->snapshotId);PutSeq(O,TEXT("watermark"),Commit->watermark);
        O->SetNumberField(TEXT("chunkCount"),Commit->chunkCount);O->SetNumberField(TEXT("rowCount"),Commit->rowCount);Put(O,TEXT("sha256"),Commit->sha256);
    } else if(const auto* X=std::get_if<foreman::Exchange>(&R.body)) {
        K=RequestKind::Exchange;TArray<Value> Events,Results;
        for(const auto& E:X->events) {
            auto Item=MakeShared<FJsonObject>();PutSeq(Item,TEXT("seq"),E.seq);Put(Item,TEXT("entityId"),E.entityId);
            Item->SetStringField(TEXT("type"),UTF8_TO_TCHAR(EVENT_TYPES[static_cast<int32>(E.type)]));
            Item->SetStringField(TEXT("origin"),UTF8_TO_TCHAR(ORIGINS[static_cast<int32>(E.origin)]));
            if(E.row) { Item->SetObjectField(TEXT("row"),BridgeRows::RowToJson(*E.row)); }Events.Add(MakeShared<FJsonValueObject>(Item));
        }
        for(const auto& Result:X->commandResults) { auto Item=MakeShared<FJsonObject>();Put(Item,TEXT("commandId"),Result.commandId);Item->SetStringField(TEXT("status"),StatusText(Result.status));Results.Add(MakeShared<FJsonValueObject>(Item)); }
        O->SetArrayField(TEXT("events"),Events);O->SetArrayField(TEXT("commandResults"),Results);
    }
    FString TextValue;FJsonSerializer::Serialize(O.ToSharedRef(),TJsonWriterFactory<TCHAR,TCondensedJsonPrintPolicy<TCHAR>>::Create(&TextValue));
    auto Bytes=BytesOf(TextValue);return DecodeRequest(K,Bytes).IsSet()?Bytes:TArray<uint8>{};
}
FString FBridgeWire::SnapshotDigest(const TArray<TArray<uint8>>& Chunks) {
    EVP_MD_CTX* Context=EVP_MD_CTX_new();if(!Context) { return {}; }
    bool Ok=EVP_DigestInit_ex(Context,EVP_sha256(),nullptr)==1;
    for(const auto& Chunk:Chunks) { if(Ok) { Ok=EVP_DigestUpdate(Context,Chunk.GetData(),Chunk.Num())==1; } }
    uint8 Digest[32];unsigned int Length=0;
    if(Ok) { Ok=EVP_DigestFinal_ex(Context,Digest,&Length)==1&&Length==32; }EVP_MD_CTX_free(Context);
    return Ok?BytesToHex(Digest,32).ToLower():FString{};
}
#undef ENV_KEYS
#undef CONNECTED_KEYS
TOptional<foreman::PreparedSnapshot> FBridgeWire::PrepareSnapshot(const foreman::Snapshot& Snapshot) {
    foreman::PreparedSnapshot Result;Result.snapshotId=Snapshot.snapshotId;Result.watermark=Snapshot.watermark;
    if(Snapshot.rows.size()>std::numeric_limits<uint32_t>::max())return {};
    Result.rowCount=static_cast<uint32_t>(Snapshot.rows.size());
    std::string Chunk;TArray<TArray<uint8>> HashChunks;
    auto Flush=[&]{if(!Chunk.empty()){TArray<uint8> Bytes;Bytes.Append(reinterpret_cast<const uint8*>(Chunk.data()),static_cast<int32>(Chunk.size()));HashChunks.Add(std::move(Bytes));Result.chunks.push_back(std::move(Chunk));Chunk.clear();}};
    for(const auto& Row:Snapshot.rows) {
        FString Json;auto Writer=TJsonWriterFactory<TCHAR,TCondensedJsonPrintPolicy<TCHAR>>::Create(&Json);
        if(!FJsonSerializer::Serialize(BridgeRows::RowToJson(Row).ToSharedRef(),Writer))return {};
        std::string Line=Narrow(Json)+"\n";
        // Sixfold worst-case outer JSON escaping plus envelope remains below 256 KiB.
        if(Line.size()>32000)return {};
        if(Chunk.size()+Line.size()>32000)Flush();Chunk+=Line;
    }
    Flush();Result.sha256=Narrow(SnapshotDigest(HashChunks));return Result;
}
