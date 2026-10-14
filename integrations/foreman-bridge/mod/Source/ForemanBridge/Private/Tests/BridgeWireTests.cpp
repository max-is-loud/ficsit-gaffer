#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "BridgeWire.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Interfaces/IPluginManager.h"

namespace {
TArray<uint8> WireBytes(const FString& Text) {
    FTCHARToUTF8 Utf8(*Text); TArray<uint8> Bytes;
    Bytes.Append(reinterpret_cast<const uint8*>(Utf8.Get()),Utf8.Length()); return Bytes;
}
foreman::Envelope FixtureEnvelope(const TSharedPtr<FJsonObject>& Object) {
    foreman::Envelope E;
    E.serverId=TCHAR_TO_UTF8(*Object->GetStringField(TEXT("serverId")));
    E.worldId=TCHAR_TO_UTF8(*Object->GetStringField(TEXT("worldId")));
    E.epoch=TCHAR_TO_UTF8(*Object->GetStringField(TEXT("epoch")));
    E.requestId=TCHAR_TO_UTF8(*Object->GetStringField(TEXT("requestId")));
    FString Connection; Object->TryGetStringField(TEXT("connectionId"),Connection); E.connectionId=TCHAR_TO_UTF8(*Connection);
    return E;
}
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBridgeWireFixtures,"ForemanBridge.Wire.SharedFixtures",EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FBridgeWireFixtures::RunTest(const FString&) {
    const FString Root=IPluginManager::Get().FindPlugin(TEXT("ForemanBridge"))->GetBaseDir();
    FString Source; if(!TestTrue(TEXT("Load shared fixtures"),FFileHelper::LoadFileToString(Source,*(Root/TEXT("Tests/fixtures/v1.json"))))) { return false; }
    TSharedPtr<FJsonObject> Fixtures;
    if(!TestTrue(TEXT("Parse fixture container"),FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Source),Fixtures))) { return false; }
    TArray<TSharedPtr<FJsonValue>> Encoded;
    for(const auto& Value:Fixtures->GetArrayField(TEXT("cases"))) {
        const auto Object=Value->AsObject(); const FString Name=Object->GetStringField(TEXT("name"));
        TArray<uint8> Bytes=WireBytes(Object->GetStringField(TEXT("body")));
        FString Hex;
        if(Object->TryGetStringField(TEXT("rawHex"),Hex)) { Bytes.SetNum(Hex.Len()/2); HexToBytes(Hex,Bytes.GetData()); }
        const bool Valid=!Object->HasField(TEXT("error"));
        const auto Kind=FBridgeWire::Kind(TCHAR_TO_UTF8(*Object->GetStringField(TEXT("kind"))));
        if(Object->GetStringField(TEXT("direction"))==TEXT("request")) {
            const auto Request=FBridgeWire::DecodeRequest(Kind,Bytes);
            TestEqual(*Name,Request.IsSet(),Valid);
            if(Request) {
                const auto Output=FBridgeWire::EncodeRequest(Request.GetValue());
                TestTrue(*(Name+TEXT(" encoded roundtrip")),FBridgeWire::DecodeRequest(Kind,Output).IsSet());
                auto Item=MakeShared<FJsonObject>(); Item->SetStringField(TEXT("name"),Name);
                Item->SetStringField(TEXT("hex"),BytesToHex(Output.GetData(),Output.Num()));
                Encoded.Add(MakeShared<FJsonValueObject>(Item));
                if(Name==TEXT("validLargeSeq")) {
                    TestTrue(TEXT("Exact large sequence"),std::get<foreman::Exchange>(Request->body).events[0].seq==9007199254740993ULL);
                    auto Invalid=Request.GetValue();
                    std::get<foreman::Exchange>(Invalid.body).events[0].row->actorPath=std::string("\xc0\x80",2);
                    TestTrue(TEXT("Reject outgoing invalid UTF-8 before conversion"),FBridgeWire::EncodeRequest(Invalid).IsEmpty());
                }
            }
        } else {
            foreman::ExpectedReply Expected{FixtureEnvelope(Object->GetObjectField(TEXT("expected"))),Kind};
            const auto Reply=FBridgeWire::DecodeResponse(Bytes,Expected);
            TestEqual(*Name,Reply.IsSet(),Valid);
            if(Reply && Name==TEXT("exchangeReply")) {
                TestTrue(TEXT("Exact ACK"),std::get<foreman::ExchangeReply>(Reply->body).ackSeq==9007199254740993ULL);
            }
        }
    }
    for(const auto& Value:Fixtures->GetArrayField(TEXT("digests"))) {
        const auto Object=Value->AsObject(); TArray<TArray<uint8>> Chunks;
        for(const auto& Chunk:Object->GetArrayField(TEXT("chunks"))) { Chunks.Add(WireBytes(Chunk->AsString())); }
        TestEqual(*Object->GetStringField(TEXT("name")),FBridgeWire::SnapshotDigest(Chunks),Object->GetStringField(TEXT("sha256")));
    }
    auto Interop=MakeShared<FJsonObject>(); Interop->SetArrayField(TEXT("requests"),Encoded);
    FString Output; FJsonSerializer::Serialize(Interop,TJsonWriterFactory<>::Create(&Output));
    TestTrue(TEXT("Write cross-language request bytes"),FFileHelper::SaveStringToFile(Output,*(Root/TEXT("out/wire-interop.json")),FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM));
    return true;
}
#endif
