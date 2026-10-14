#include "BridgeWire.h"
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
using Object = TSharedPtr<FJsonObject>;
using Value = TSharedPtr<FJsonValue>;
using namespace foreman;
FString Wide(const std::string& Text) { FUTF8ToTCHAR Utf8(Text.data(),static_cast<int32>(Text.size())); return FString(Utf8.Length(),Utf8.Get()); }
std::string Narrow(const FString& Text) { FTCHARToUTF8 Utf8(*Text,Text.Len()); return std::string(Utf8.Get(),Utf8.Length()); }
TArray<uint8> BytesOf(const FString& Text) {
    FTCHARToUTF8 Utf8(*Text,Text.Len()); TArray<uint8> Bytes;
    Bytes.Append(reinterpret_cast<const uint8*>(Utf8.Get()),Utf8.Length()); return Bytes;
}
Value Field(const Object& O,const TCHAR* Key) { if(!O) { return {}; } const auto* Found=O->Values.Find(Key); return Found?*Found:Value{}; }
bool Text(const Object& O,const TCHAR* Key,std::string& Out,size_t Max=4096,bool Empty=false) {
    const auto V=Field(O,Key); if(!V || V->Type!=EJson::String) { return false; }
    Out=Narrow(V->AsString()); return (Empty || !Out.empty()) && Out.size()<=Max;
}
Object Child(const Object& O,const TCHAR* Key) { const auto V=Field(O,Key); return V && V->Type==EJson::Object ? V->AsObject():Object{}; }
bool Fields(const Object& O,std::initializer_list<const TCHAR*> Required,std::initializer_list<const TCHAR*> Optional={}) {
    if(!O) { return false; }
    for(const auto* Key:Required) { if(!O->HasField(Key)) { return false; } }
    for(const auto& Pair:O->Values) {
        bool Found=false;
        for(const auto* Key:Required) { Found|=Pair.Key==Key; }
        for(const auto* Key:Optional) { Found|=Pair.Key==Key; }
        if(!Found) { return false; }
    }
    return true;
}
bool Hex(const std::string& S,size_t Length) {
    if(S.size()!=Length) { return false; }
    for(char C:S) { if(!((C>='0'&&C<='9')||(C>='a'&&C<='f'))) { return false; } } return true;
}
bool Uuid(const std::string& S) {
    if(S.size()!=36) { return false; }
    for(size_t I=0;I<S.size();++I) {
        if(I==8||I==13||I==18||I==23) { if(S[I]!='-') { return false; } }
        else if(!((S[I]>='0'&&S[I]<='9')||(S[I]>='a'&&S[I]<='f'))) { return false; }
    } return true;
}
bool Id(const Object& O,const TCHAR* Key,std::string& Out) { return Text(O,Key,Out,36)&&Uuid(Out); }
bool SeqText(const std::string& S,uint64_t& Out,bool Zero=true) {
    if(S.empty()||S.size()>20||(S.size()>1&&S[0]=='0')) { return false; }
    uint64_t N=0;
    for(char C:S) {
        if(C<'0'||C>'9') { return false; }
        const uint64_t Digit=C-'0';
        if(N>(std::numeric_limits<uint64_t>::max()-Digit)/10) { return false; }
        N=N*10+Digit;
    }
    if(!Zero&&N==0) { return false; } Out=N;return true;
}
bool Seq(const Object& O,const TCHAR* Key,uint64_t& Out,bool Zero=true) { std::string S;return Text(O,Key,S,20)&&SeqText(S,Out,Zero); }
bool Number(const Value& V,double& Out) { if(!V||V->Type!=EJson::Number) { return false; } Out=V->AsNumber();return FMath::IsFinite(Out); }
bool UInt(const Object& O,const TCHAR* Key,uint32_t& Out) {
    double N; if(!Number(Field(O,Key),N)||N<0||N>4294967295.0||N!=FMath::FloorToDouble(N)) { return false; }
    Out=static_cast<uint32_t>(N);return true;
}
bool EnvelopeOf(const Object& O,Envelope& E,bool Connected) {
    double Protocol;
    return Number(Field(O,TEXT("protocol")),Protocol)&&Protocol==1&&Id(O,TEXT("serverId"),E.serverId)
        &&Id(O,TEXT("worldId"),E.worldId)&&Id(O,TEXT("epoch"),E.epoch)&&Id(O,TEXT("requestId"),E.requestId)
        &&(!Connected||Id(O,TEXT("connectionId"),E.connectionId));
}
// Validate UTF-8 scalars before Unreal conversion, which may otherwise replace invalid input.
bool Scalars(TConstArrayView<uint8> Bytes,TArray<uint32>* Out=nullptr) {
    for(int32 I=0;I<Bytes.Num();) {
        const uint8 First=Bytes[I++];uint32 Code=First,Minimum=0;int32 More=0;
        if(First>=0xc2&&First<=0xdf) { Code=First&31;More=1;Minimum=0x80; }
        else if(First>=0xe0&&First<=0xef) { Code=First&15;More=2;Minimum=0x800; }
        else if(First>=0xf0&&First<=0xf4) { Code=First&7;More=3;Minimum=0x10000; }
        else if(First>=0x80) { return false; }
        if(I+More>Bytes.Num()) { return false; }
        while(More-->0) { uint8 C=Bytes[I++];if((C&0xc0)!=0x80) { return false; } Code=(Code<<6)|(C&63); }
        if(Code<Minimum||Code>0x10ffff||(Code>=0xd800&&Code<=0xdfff)) { return false; }
        if(Out) { Out->Add(Code); }
    } return true;
}
bool ValidString(const std::string& S) {
    return S.size()<=Limits::MaxBodyBytes && Scalars(TConstArrayView<uint8>(reinterpret_cast<const uint8*>(S.data()),static_cast<int32>(S.size())));
}
bool ValidRowInput(const Row& R) {
    if(!ValidString(R.entityId)||!ValidString(R.actorPath)||!ValidString(R.classPath)) { return false; }
    for(const auto& V:{R.transform.position,R.transform.rotation,R.transform.scale}) {
        for(double N:V) { if(!FMath::IsFinite(N)) { return false; } }
    }
    return !R.player || (ValidString(R.player->platform)&&ValidString(R.player->accountId)&&ValidString(R.player->displayName));
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
    for(const auto& EventValue:X.events) { if(!ValidString(EventValue.entityId)||(EventValue.row&&!ValidRowInput(*EventValue.row))) { return false; } }
    for(const auto& Result:X.commandResults) { if(!ValidString(Result.commandId)) { return false; } }
    return true;
}
int32 HexDigit(uint8 C) { if(C>='0'&&C<='9') { return C-'0'; } if(C>='a'&&C<='f') { return C-'a'+10; } if(C>='A'&&C<='F') { return C-'A'+10; } return -1; }
bool EscapeCode(TConstArrayView<uint8> B,int32 Start,uint32& Code) {
    if(Start+4>B.Num()) { return false; }Code=0;
    for(int32 I=Start;I<Start+4;++I) { int32 D=HexDigit(B[I]);if(D<0) { return false; }Code=Code*16+D; } return true;
}
bool JsonUnicode(TConstArrayView<uint8> B) {
    if(!Scalars(B)) { return false; }
    bool InString=false;int32 Depth=0;
    for(int32 I=0;I<B.Num();++I) {
        uint8 C=B[I];
        if(C=='"') { InString=!InString; }
        else if(InString&&C=='\\') {
            if(++I>=B.Num()) { return false; }
            if(B[I]=='u') {
                uint32 Code;if(!EscapeCode(B,I+1,Code)) { return false; }I+=4;
                if(Code>=0xd800&&Code<=0xdbff) {
                    if(I+6>=B.Num()||B[I+1]!='\\'||B[I+2]!='u') { return false; }
                    uint32 Low;if(!EscapeCode(B,I+3,Low)||Low<0xdc00||Low>0xdfff) { return false; } I+=6;
                } else if(Code>=0xdc00&&Code<=0xdfff) { return false; }
            }
        } else if(!InString) {
            if(C=='{'||C=='[') { if(++Depth>32) { return false; } }
            else if(C=='}'||C==']') { --Depth; }
        }
    }return true;
}
Object Parse(TConstArrayView<uint8> B) {
    if(B.Num()==0||B.Num()>static_cast<int32>(Limits::MaxBodyBytes)||!JsonUnicode(B)) { return {}; }
    FUTF8ToTCHAR Utf8(reinterpret_cast<const ANSICHAR*>(B.GetData()),B.Num());
    FString Source(Utf8.Length(),Utf8.Get());Object O;
    if(!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Source),O)) { return {}; }return O;
}
bool Vector(const Object& O,const TCHAR* Key,std::array<double,3>& Out) {
    auto V=Field(O,Key);if(!V||V->Type!=EJson::Array||V->AsArray().Num()!=3) { return false; }
    for(int I=0;I<3;++I) { if(!Number(V->AsArray()[I],Out[I])) { return false; } }return true;
}
bool RowOf(const Object& O,Row& R) {
    if(!Fields(O,{TEXT("entityId"),TEXT("actorPath"),TEXT("classPath"),TEXT("transform"),TEXT("player")})
        ||!Id(O,TEXT("entityId"),R.entityId)||!Text(O,TEXT("actorPath"),R.actorPath)||!Text(O,TEXT("classPath"),R.classPath)) { return false; }
    auto T=Child(O,TEXT("transform"));
    if(!Fields(T,{TEXT("position"),TEXT("rotation"),TEXT("scale")})||!Vector(T,TEXT("position"),R.transform.position)
        ||!Vector(T,TEXT("rotation"),R.transform.rotation)||!Vector(T,TEXT("scale"),R.transform.scale)) { return false; }
    auto P=Field(O,TEXT("player"));if(P->Type==EJson::Null) { return true; }
    Player Person;auto PO=Child(O,TEXT("player"));
    if(!Fields(PO,{TEXT("platform"),TEXT("accountId"),TEXT("displayName")})||!Text(PO,TEXT("platform"),Person.platform,1024)
        ||!Text(PO,TEXT("accountId"),Person.accountId,1024)||!Text(PO,TEXT("displayName"),Person.displayName,1024)) { return false; }
    R.player=std::move(Person);return true;
}
bool EventOf(const Object& O,Event& E) {
    std::string Type,OriginText;
    if(!Text(O,TEXT("type"),Type)||!Text(O,TEXT("origin"),OriginText)||!Seq(O,TEXT("seq"),E.seq,false)||!Id(O,TEXT("entityId"),E.entityId)) { return false; }
    if(OriginText!="placed"&&OriginText!="reconciled") { return false; }E.origin=OriginText=="placed"?Origin::Placed:Origin::Reconciled;
    if(Type=="constructor.upsert") {
        if(!Fields(O,{TEXT("seq"),TEXT("type"),TEXT("entityId"),TEXT("origin"),TEXT("row")})) { return false; }
        Row R;if(!RowOf(Child(O,TEXT("row")),R)||R.entityId!=E.entityId) { return false; }E.row=std::move(R);E.type=EventType::Upsert;
    } else if(Type=="constructor.remove") {
        if(!Fields(O,{TEXT("seq"),TEXT("type"),TEXT("entityId"),TEXT("origin")})) { return false; }E.type=EventType::Remove;
    } else { return false; }return true;
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
void Put(const Object& O,const TCHAR* Key,const std::string& S) { O->SetStringField(Key,Wide(S)); }
void PutSeq(const Object& O,const TCHAR* Key,uint64_t N) { Put(O,Key,std::to_string(N)); }
Object EnvelopeJson(const Envelope& E,bool Connected) {
    auto O=MakeShared<FJsonObject>();O->SetNumberField(TEXT("protocol"),1);Put(O,TEXT("serverId"),E.serverId);Put(O,TEXT("worldId"),E.worldId);
    Put(O,TEXT("epoch"),E.epoch);Put(O,TEXT("requestId"),E.requestId);if(Connected) { Put(O,TEXT("connectionId"),E.connectionId); }return O;
}
void PutVector(const Object& O,const TCHAR* Key,const std::array<double,3>& V) {
    TArray<Value> Values;for(double N:V) { Values.Add(MakeShared<FJsonValueNumber>(N)); }O->SetArrayField(Key,Values);
}
Object RowJson(const Row& R) {
    auto O=MakeShared<FJsonObject>();Put(O,TEXT("entityId"),R.entityId);Put(O,TEXT("actorPath"),R.actorPath);Put(O,TEXT("classPath"),R.classPath);
    auto T=MakeShared<FJsonObject>();PutVector(T,TEXT("position"),R.transform.position);PutVector(T,TEXT("rotation"),R.transform.rotation);PutVector(T,TEXT("scale"),R.transform.scale);O->SetObjectField(TEXT("transform"),T);
    if(R.player) { auto P=MakeShared<FJsonObject>();Put(P,TEXT("platform"),R.player->platform);Put(P,TEXT("accountId"),R.player->accountId);Put(P,TEXT("displayName"),R.player->displayName);O->SetObjectField(TEXT("player"),P); }
    else { O->SetField(TEXT("player"),MakeShared<FJsonValueNull>()); }return O;
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
            if(!RowOf(Parse(TConstArrayView<uint8>(reinterpret_cast<const uint8*>(Line.data()),static_cast<int32>(Line.size()))),RowValue)||RowValue.entityId<=Previous) { return {}; }
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
            Item->SetStringField(TEXT("type"),E.type==EventType::Upsert?TEXT("constructor.upsert"):TEXT("constructor.remove"));
            Item->SetStringField(TEXT("origin"),E.origin==Origin::Placed?TEXT("placed"):TEXT("reconciled"));
            if(E.row) { Item->SetObjectField(TEXT("row"),RowJson(*E.row)); }Events.Add(MakeShared<FJsonValueObject>(Item));
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
        if(!FJsonSerializer::Serialize(RowJson(Row).ToSharedRef(),Writer))return {};
        std::string Line=Narrow(Json)+"\n";
        // Sixfold worst-case outer JSON escaping plus envelope remains below 256 KiB.
        if(Line.size()>32000)return {};
        if(Chunk.size()+Line.size()>32000)Flush();Chunk+=Line;
    }
    Flush();Result.sha256=Narrow(SnapshotDigest(HashChunks));return Result;
}
