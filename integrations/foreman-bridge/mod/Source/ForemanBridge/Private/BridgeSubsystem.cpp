#include "BridgeSubsystem.h"
#include "BridgeGameAdapter.h"
#include "Core/BridgeState.h"
#include "Core/BridgeDelivery.h"
#include "BridgeConfig.h"
#include "BridgeTransport.h"
#include "BridgeWire.h"
#include "BridgeBuildInfo.h"
#include "FGGameMode.h"
#include "Async/Async.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/DateTime.h"
#include "FGBuildableSubsystem.h"
#include "Buildables/FGBuildable.h"
#include "Engine/World.h"
#include "TimerManager.h"
#include "HAL/PlatformTime.h"
#include "Misc/Guid.h"

namespace {
foreman::MonotonicTime BridgeNow(){return foreman::MonotonicTime(static_cast<int64>(FPlatformTime::Seconds()*1000.0));}
int64 BridgeUtc(){const auto Now=FDateTime::UtcNow();return Now.ToUnixTimestamp()*1000+Now.GetMillisecond();}
std::string NewBridgeId(){return TCHAR_TO_UTF8(*FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphensLower));}
}
DEFINE_LOG_CATEGORY_STATIC(LogForemanBridgeWorld, Log, All);
ABridgeSubsystem::ABridgeSubsystem() {
    ReplicationPolicy = ESubsystemReplicationPolicy::SpawnOnServer;
    bReplicates = false;
    bNetLoadOnClient = false;
    PrimaryActorTick.bCanEverTick = false;
}
ABridgeSubsystem::~ABridgeSubsystem() = default;
void ABridgeSubsystem::BeginPlay() {
    Super::BeginPlay();
    if (!HasAuthority()) { return; }
    TearDownHandle = FWorldDelegates::OnWorldBeginTearDown.AddUObject(this, &ABridgeSubsystem::OnWorldTearDown);
    ReadyTimer = GetWorldTimerManager().SetTimerForNextTick(this, &ABridgeSubsystem::InitialiseBridge);
}
void ABridgeSubsystem::InitialiseBridge() {
    if (Closing || Ready || !HasAuthority() || GetWorld()->bIsTearingDown) { return; }
    AFGBuildableSubsystem* Registry = AFGBuildableSubsystem::Get(GetWorld());
    if (!IsValid(Registry) || !Registry->HasActorBegunPlay()) {
        GetWorldTimerManager().SetTimer(ReadyTimer, this, &ABridgeSubsystem::InitialiseBridge, 0.25f, false);
        return;
    }
    Epoch = FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphensLower);
    State = MakeUnique<foreman::State>(TCHAR_TO_UTF8(*Epoch), foreman::Limits{});
    Buildables = Registry;
    Registry->BuildableConstructedGlobalDelegate.AddDynamic(this, &ABridgeSubsystem::OnConstructed);
    Registry->mBuildableRemovedDelegate.AddDynamic(this, &ABridgeSubsystem::OnRemoved);
    const double Started = FPlatformTime::Seconds();
    std::vector<foreman::Row> Rows;
    for (AFGBuildable* Buildable : Registry->GetAllBuildablesRef()) {
        auto Row = BridgeGameAdapter::CaptureConstructor(Buildable);
        if (Row) {
            Entities.Add(Buildable, UTF8_TO_TCHAR(Row->entityId.c_str()));
            Rows.push_back(std::move(Row.GetValue()));
        }
    }
    State->Seed(std::move(Rows));
    Ready = true;
    UE_LOG(LogForemanBridgeWorld, Display, TEXT("Bridge baseline epoch=%s count=%llu seq=0 captureMs=%.3f"),
        *Epoch, static_cast<uint64>(State->Count()), (FPlatformTime::Seconds()-Started)*1000.0);
    FString ConfigPath;
    if(!FParse::Value(FCommandLine::Get(),TEXT("ForemanBridgeConfig="),ConfigPath))return;
    const auto Config=LoadBridgeConfig(ConfigPath);
    const auto* Mode=GetWorld()->GetAuthGameMode<AFGGameMode>();
    if(!Config||!Mode||!Config->MatchesSession(Mode->GetSaveSessionName())) {
        UE_LOG(LogForemanBridgeWorld,Warning,TEXT("Bridge receiver disabled: invalid config or session binding"));return;
    }
    foreman::Envelope Identity{TCHAR_TO_UTF8(*Config->ServerId),TCHAR_TO_UTF8(*Config->WorldId),TCHAR_TO_UTF8(*Epoch),"",""};
    foreman::Provenance Provenance{"513885","3.12.0","0.1.0",FOREMAN_STARTER_SHA,FOREMAN_SOURCE_SHA};
    Delivery=MakeUnique<foreman::Delivery>(*State,std::move(Identity),std::move(Provenance),BridgeNow,[]{return static_cast<double>(FMath::FRand());},NewBridgeId);
    Transport=MakeUnique<FBridgeTransport>(*Config);
    ++LifetimeGeneration;
    GetWorldTimerManager().SetTimer(PumpTimer,this,&ABridgeSubsystem::PumpBridge,0.1f,true);
}
void ABridgeSubsystem::OnConstructed(AFGBuildable* Buildable) {
    if (Closing || !Ready || GetWorld()->bIsTearingDown) { return; }
    const double Started = FPlatformTime::Seconds();
    auto Row = BridgeGameAdapter::CaptureConstructor(Buildable);
    if (!Row) { return; }
    if (const FString* Existing = Entities.Find(Buildable)) { Row->entityId = TCHAR_TO_UTF8(**Existing); }
    else { Entities.Add(Buildable, UTF8_TO_TCHAR(Row->entityId.c_str())); }
    const auto Event = State->Upsert(std::move(Row.GetValue()), foreman::Origin::Placed);
    if (Event) {
        LatestSeq = Event->seq;
        LogEvent(*Event, Started);

    }
}
void ABridgeSubsystem::OnRemoved(AFGBuildable* Buildable) {
    if (Closing || !Ready || GetWorld()->bIsTearingDown || !Buildable) { return; }
    const FString* Entity = Entities.Find(Buildable);
    if (!Entity) { return; }
    // Registry removal can also accompany unload. Only explicit dismantling is evidence.
    if (!Buildable->GetIsDismantled() && !Buildable->IsAboutToBeDismantled() && !Buildable->GetIsPendingDismantleRemoval()) {
        UnresolvedRemoval = true;
        UE_LOG(LogForemanBridgeWorld, Error, TEXT("Bridge unresolved registry removal: retaining evidence; adapter acceptance blocked"));
        return;
    }
    const double Started = FPlatformTime::Seconds();
    const auto Event = State->Remove(TCHAR_TO_UTF8(**Entity));
    Entities.Remove(Buildable);
    if (Event) { LatestSeq = Event->seq; LogEvent(*Event, Started); }
}
void ABridgeSubsystem::LogEvent(const foreman::Event& Event, double Started) const {
    UE_LOG(LogForemanBridgeWorld, Display, TEXT("Bridge event epoch=%s seq=%llu type=%s entity=%s count=%llu captureMs=%.3f creator=%s"),
        *Epoch, Event.seq, Event.type==foreman::EventType::Upsert ? TEXT("upsert") : TEXT("remove"),
        UTF8_TO_TCHAR(Event.entityId.c_str()), static_cast<uint64>(State->Count()), (FPlatformTime::Seconds()-Started)*1000.0,
        Event.row && Event.row->player ? TEXT("resolved") : TEXT("null"));
}
void ABridgeSubsystem::PumpBridge() {
    if(Closing||!Ready||!Delivery||!Transport||GetWorld()->bIsTearingDown)return;
    const auto Now=BridgeNow();Delivery->CheckClock(BridgeUtc(),Now);
    const double CaptureStarted=FPlatformTime::Seconds();
    auto Request=Delivery->Next(Now);
    const TWeakObjectPtr<ABridgeSubsystem> Weak(this);const uint64 Generation=LifetimeGeneration;
    if(auto Snapshot=Delivery->TakeSnapshot()) {
        UE_LOG(LogForemanBridgeWorld,Display,TEXT("Bridge snapshot frozen epoch=%s watermark=%llu rows=%llu captureMs=%.3f"),*Epoch,Snapshot->watermark,static_cast<uint64>(Snapshot->rows.size()),(FPlatformTime::Seconds()-CaptureStarted)*1000.0);
        Async(EAsyncExecution::ThreadPool,[Weak,Generation,Snapshot=std::move(*Snapshot)]() mutable {
            auto Prepared=FBridgeWire::PrepareSnapshot(Snapshot);
            AsyncTask(ENamedThreads::GameThread,[Weak,Generation,Prepared=std::move(Prepared)]() mutable {
                auto* Self=Weak.Get();if(!Self||Self->Closing||Self->LifetimeGeneration!=Generation||!Self->Delivery)return;
                if(Prepared)Self->Delivery->OnPrepared(std::move(Prepared.GetValue()));
                else {Self->Delivery->Stop();UE_LOG(LogForemanBridgeWorld,Error,TEXT("Bridge snapshot encoding rejected; receiver disabled"));}
            });
        });
    }
    if(!Request)return;
    Transport->CancelAll(); // Retire any timed-out request before starting its retry.
    const auto RequestId=Request->envelope.requestId;
    Transport->Send(std::move(*Request),[Weak,Generation,RequestId](foreman::Outcome Outcome) {
        auto* Self=Weak.Get();if(!Self||Self->Closing||Self->LifetimeGeneration!=Generation||!Self->Delivery)return;
        const auto Now=BridgeNow();
        if(Outcome.reply) {
            const auto Before=Self->Delivery->LastAck();Self->Delivery->OnReply(RequestId,*Outcome.reply,Now);
            if(Self->Delivery->LastAck()!=Before)UE_LOG(LogForemanBridgeWorld,Display,TEXT("Bridge receiver ack epoch=%s seq=%llu"),*Self->Epoch,Self->Delivery->LastAck());
            for(const auto& Command:Self->Delivery->TakeCommands()) {
                const auto Decision=Self->Delivery->AdmitCommand(Command,BridgeUtc(),Now);
                if(Decision==foreman::CommandDecision::Duplicate)continue;
                auto Status=foreman::CommandStatus::Rejected;
                if(Decision==foreman::CommandDecision::Expired)Status=foreman::CommandStatus::Expired;
                if(Decision==foreman::CommandDecision::Dispatch) {
                    const bool Sent=BridgeGameAdapter::BroadcastPlainChat(Self->GetWorld(),UTF8_TO_TCHAR(Command.text.c_str()));
                    Status=Sent?foreman::CommandStatus::Executed:foreman::CommandStatus::Skipped;
                    UE_LOG(LogForemanBridgeWorld,Display,TEXT("Bridge receiver chat epoch=%s causalSeq=%llu dispatched=%d"),*Self->Epoch,Command.causalSeq,Sent);
                }
                Self->Delivery->CompleteCommand(Command.commandId,Status);
            }
        } else {
            auto Failure=foreman::Failure::Retryable;
            if(Outcome.tlsError)Failure=foreman::Failure::Tls;
            else if(Outcome.httpStatus==401||Outcome.httpStatus==403)Failure=foreman::Failure::Auth;
            else if(Outcome.httpStatus==409)Failure=foreman::Failure::Conflict;
            else if(Outcome.httpStatus==426||(Outcome.httpStatus>=300&&Outcome.httpStatus<400)||(Outcome.httpStatus>=400&&Outcome.httpStatus<500))Failure=foreman::Failure::Protocol;
            Self->Delivery->OnFailure(RequestId,Failure,Now);
            const int32 Category=static_cast<int32>(Failure);const double Seconds=FPlatformTime::Seconds();
            const double* Last=Self->LastError.Find(Category);
            if(!Last||Seconds-*Last>=30.0){Self->LastError.Add(Category,Seconds);UE_LOG(LogForemanBridgeWorld,Warning,TEXT("Bridge receiver failure category=%d http=%d"),Category,Outcome.httpStatus);}
        }
    });
}
FString ABridgeSubsystem::Status() const {
    return FString::Printf(TEXT("Foreman bridge: %s; constructors=%llu; epoch=%s; seq=%llu; ack=%llu; queue=%llu; historyGap=%s"),
        Closing?TEXT("closing"):UnresolvedRemoval?TEXT("unresolved removal"):Delivery?UTF8_TO_TCHAR(Delivery->Status()):Ready?TEXT("receiver disabled"):TEXT("initialising"),
        State?static_cast<uint64>(State->Count()):0,*Epoch,State?State->Latest():0,Delivery?Delivery->LastAck():0,
        State?static_cast<uint64>(State->QueueSize()):0,State&&State->HasGap()?TEXT("yes"):TEXT("no"));
}
void ABridgeSubsystem::OnWorldTearDown(UWorld* World) { if (World==GetWorld()) { StopBridge(); } }
void ABridgeSubsystem::StopBridge() {
    if (Closing) { return; }
    Closing = true;
    ++LifetimeGeneration;
    GetWorldTimerManager().ClearTimer(PumpTimer);
    if(Delivery)Delivery->Stop();
    if(Transport)Transport->CancelAll();
    GetWorldTimerManager().ClearTimer(ReadyTimer);
    if (AFGBuildableSubsystem* Registry = Buildables.Get()) {
        Registry->BuildableConstructedGlobalDelegate.RemoveDynamic(this, &ABridgeSubsystem::OnConstructed);
        Registry->mBuildableRemovedDelegate.RemoveDynamic(this, &ABridgeSubsystem::OnRemoved);
    }
    FWorldDelegates::OnWorldBeginTearDown.Remove(TearDownHandle);
    Entities.Empty();
    UE_LOG(LogForemanBridgeWorld, Display, TEXT("Bridge stopped epoch=%s; no teardown events emitted"), *Epoch);
}
void ABridgeSubsystem::EndPlay(const EEndPlayReason::Type Reason) { StopBridge(); Super::EndPlay(Reason); }
