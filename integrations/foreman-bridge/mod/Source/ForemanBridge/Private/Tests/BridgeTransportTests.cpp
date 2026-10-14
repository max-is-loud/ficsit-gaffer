#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/Guid.h"
#include "BridgeConfig.h"
#include "BridgeWire.h"
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBridgeConfigTest,"ForemanBridge.Transport.Config",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FBridgeConfigTest::RunTest(const FString&) {
    const FString Path=FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir()/TEXT("bridge-test-config.json"));
    const FString Valid=TEXT("{\"enabled\":true,\"url\":\"https://127.0.0.1:19443\",\"token\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"serverId\":\"10000000-0000-4000-8000-000000000001\",\"worldId\":\"20000000-0000-4000-8000-000000000001\",\"sessionName\":\"test-world\"}");
    FFileHelper::SaveStringToFile(Valid,*Path);
    const auto Config=LoadBridgeConfig(Path);TestTrue(TEXT("Valid HTTPS config"),Config.IsSet());
    if(Config){TestTrue(TEXT("Bound session"),Config->MatchesSession(TEXT("test-world")));TestFalse(TEXT("Wrong session disabled"),Config->MatchesSession(TEXT("other")));}
    TestFalse(TEXT("Absolute path required"),LoadBridgeConfig(TEXT("relative.json")).IsSet());
    for(const FString Bad:{Valid.Replace(TEXT("https://"),TEXT("http://")),Valid.Replace(TEXT("127.0.0.1"),TEXT("user:pass@127.0.0.1")),Valid.Replace(TEXT("19443"),TEXT("19443/path?secret=1")),Valid.Replace(TEXT("10000000-"),TEXT("invalid-")),FString::ChrN(65537,TEXT('x'))}) {
        FFileHelper::SaveStringToFile(Bad,*Path);TestFalse(TEXT("Unsafe config rejected"),LoadBridgeConfig(Path).IsSet());
    }
    IFileManager::Get().Delete(*Path);return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBridgeSnapshotTest,"ForemanBridge.Wire.SnapshotPreparation",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FBridgeSnapshotTest::RunTest(const FString&) {
    foreman::Snapshot Snapshot;Snapshot.epoch="10000000-0000-4000-8000-000000000001";Snapshot.snapshotId="20000000-0000-4000-8000-000000000001";Snapshot.watermark=5;
    auto Empty=FBridgeWire::PrepareSnapshot(Snapshot);TestTrue(TEXT("Empty snapshot prepared"),Empty.IsSet());
    if(Empty){TestEqual(TEXT("Empty chunk count"),Empty->chunks.size(),size_t(0));TestEqual(TEXT("Empty hash"),FString(UTF8_TO_TCHAR(Empty->sha256.c_str())),TEXT("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));}
    for(int32 I=0;I<100;++I){foreman::Row Row;Row.entityId=TCHAR_TO_UTF8(*FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphensLower));Row.actorPath=std::string(4000,'x');Row.classPath="/constructor";Snapshot.rows.push_back(Row);}
    std::sort(Snapshot.rows.begin(),Snapshot.rows.end(),[](const auto& A,const auto& B){return A.entityId<B.entityId;});
    auto Prepared=FBridgeWire::PrepareSnapshot(Snapshot);TestTrue(TEXT("Multi chunk snapshot prepared"),Prepared.IsSet());
    if(Prepared){TestTrue(TEXT("Chunked"),Prepared->chunks.size()>1);for(const auto& Chunk:Prepared->chunks)TestTrue(TEXT("Conservative bounded chunk"),Chunk.size()<=32000);TestEqual(TEXT("Watermark frozen"),Prepared->watermark,uint64_t(5));}
    return true;
}
#endif
#if WITH_DEV_AUTOMATION_TESTS
#include "BridgeTransport.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "HAL/PlatformTime.h"
struct FBridgeSecurityProbe {
    TUniquePtr<FBridgeTransport> Transport;
    TOptional<foreman::Outcome> Result;
    double Started=FPlatformTime::Seconds();
};
class FBridgeAwaitSecurity : public IAutomationLatentCommand {
public:
    FBridgeAwaitSecurity(TSharedRef<FBridgeSecurityProbe> In,FAutomationTestBase* Test,bool Tls=false):Probe(In),Owner(Test),ExpectTls(Tls){}
    virtual bool Update() override {
        if(!Probe->Result&&FPlatformTime::Seconds()-Probe->Started<15.0)return false;
        Owner->TestTrue(TEXT("Transport callback completed"),Probe->Result.IsSet());
        if(Probe->Result){if(ExpectTls)Owner->TestTrue(TEXT("Hostname verification rejects certificate"),Probe->Result->tlsError);else Owner->TestEqual(TEXT("307 returned without following redirect"),Probe->Result->httpStatus,307);}
        Probe->Transport->CancelAll();return true;
    }
private:TSharedRef<FBridgeSecurityProbe> Probe;FAutomationTestBase* Owner;bool ExpectTls;
};
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBridgeRedirectTest,"ForemanBridge.Security.Redirect",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FBridgeRedirectTest::RunTest(const FString&) {
    FString Path;FParse::Value(FCommandLine::Get(),TEXT("BridgeTransportTestConfig="),Path);
    auto Config=LoadBridgeConfig(Path);if(!Config){AddError(TEXT("Provide disposable transport test config and trusted test CA"));return false;}
    auto Probe=MakeShared<FBridgeSecurityProbe>();Probe->Transport=MakeUnique<FBridgeTransport>(*Config);
    foreman::Request Request;Request.envelope={TCHAR_TO_UTF8(*Config->ServerId),TCHAR_TO_UTF8(*Config->WorldId),"30000000-0000-4000-8000-000000000001","40000000-0000-4000-8000-000000000001",""};
    Request.body=foreman::Hello{0,0,{"test","test","test",std::string(40,'a'),std::string(64,'b')}};
    Probe->Transport->Send(Request,[Probe](foreman::Outcome Outcome){Probe->Result=std::move(Outcome);});
    ADD_LATENT_AUTOMATION_COMMAND(FBridgeAwaitSecurity(Probe,this));return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBridgeWrongHostTest,"ForemanBridge.Security.WrongHostname",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FBridgeWrongHostTest::RunTest(const FString&) {
    FString Path;FParse::Value(FCommandLine::Get(),TEXT("BridgeTransportTestConfig="),Path);
    auto Config=LoadBridgeConfig(Path);if(!Config){AddError(TEXT("Provide disposable transport test config and trusted test CA"));return false;}
    Config->Url=TEXT("https://localhost:19444");
    auto Probe=MakeShared<FBridgeSecurityProbe>();Probe->Transport=MakeUnique<FBridgeTransport>(*Config);
    foreman::Request Request;Request.envelope={TCHAR_TO_UTF8(*Config->ServerId),TCHAR_TO_UTF8(*Config->WorldId),"30000000-0000-4000-8000-000000000001","40000000-0000-4000-8000-000000000001",""};
    Request.body=foreman::Hello{0,0,{"test","test","test",std::string(40,'a'),std::string(64,'b')}};
    Probe->Transport->Send(Request,[Probe](foreman::Outcome Outcome){Probe->Result=std::move(Outcome);});
    ADD_LATENT_AUTOMATION_COMMAND(FBridgeAwaitSecurity(Probe,this,true));return true;
}
#endif

#if WITH_DEV_AUTOMATION_TESTS
#include <atomic>
#include "HAL/PlatformProcess.h"
struct FBridgeCancelProbe {
    TUniquePtr<FBridgeTransport> Transport;
    std::atomic<bool> Ready{false},Release{false};
    std::atomic<int> Dispatches{0},Callbacks{0};
    double Started=FPlatformTime::Seconds(),ReleasedAt=0;
};
class FBridgeAwaitCancel : public IAutomationLatentCommand {
public:
    FBridgeAwaitCancel(TSharedRef<FBridgeCancelProbe,ESPMode::ThreadSafe> In,FAutomationTestBase* Test):Probe(In),Owner(Test){}
    bool Update() override {
        if(!Probe->ReleasedAt) {
            if(!Probe->Ready&&FPlatformTime::Seconds()-Probe->Started<10)return false;
            Owner->TestTrue(TEXT("Worker reached dispatch boundary"),Probe->Ready.load());
            Probe->Transport->CancelAll();Probe->Release=true;Probe->ReleasedAt=FPlatformTime::Seconds();return false;
        }
        if(FPlatformTime::Seconds()-Probe->ReleasedAt<1)return false;
        Owner->TestEqual(TEXT("Cancelled work never starts HTTP"),Probe->Dispatches.load(),0);
        Owner->TestEqual(TEXT("Cancelled work never calls owner"),Probe->Callbacks.load(),0);
        Probe->Transport.Reset();return true;
    }
private:TSharedRef<FBridgeCancelProbe,ESPMode::ThreadSafe> Probe;FAutomationTestBase* Owner;
};
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBridgeCancelTest,"ForemanBridge.Transport.CancelBeforeDispatch",EAutomationTestFlags::EditorContext|EAutomationTestFlags::EngineFilter)
bool FBridgeCancelTest::RunTest(const FString&) {
    FBridgeConfig Config;Config.Url=TEXT("https://127.0.0.1:9");Config.Token=TEXT("test-only");
    auto Probe=MakeShared<FBridgeCancelProbe,ESPMode::ThreadSafe>();Probe->Transport=MakeUnique<FBridgeTransport>(Config);
    Probe->Transport->SetDispatchTestHooks([Probe](){Probe->Ready=true;const double Start=FPlatformTime::Seconds();while(!Probe->Release&&FPlatformTime::Seconds()-Start<15)FPlatformProcess::SleepNoStats(0.001f);},[Probe](){++Probe->Dispatches;});
    foreman::Request Request;Request.envelope={"10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000001","30000000-0000-4000-8000-000000000001","40000000-0000-4000-8000-000000000001",""};
    Request.body=foreman::Hello{0,0,{"test","test","test",std::string(40,'a'),std::string(64,'b')}};
    Probe->Transport->Send(Request,[Probe](foreman::Outcome){++Probe->Callbacks;});
    ADD_LATENT_AUTOMATION_COMMAND(FBridgeAwaitCancel(Probe,this));return true;
}
#endif
