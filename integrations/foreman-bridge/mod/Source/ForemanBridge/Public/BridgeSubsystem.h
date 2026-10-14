#pragma once
#include "Subsystem/ModSubsystem.h"
#include "BridgeSubsystem.generated.h"
namespace foreman { class State; class Delivery; struct Event; }
class FBridgeTransport;
class AFGBuildable;
class AFGBuildableSubsystem;
UCLASS()
class FOREMANBRIDGE_API ABridgeSubsystem : public AModSubsystem {
    GENERATED_BODY()
public:
    ABridgeSubsystem();
    virtual ~ABridgeSubsystem() override;
    FString Status() const;
protected:
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;
private:
    void InitialiseBridge();
    void StopBridge();
    void PumpBridge();
    void OnWorldTearDown(UWorld* World);
    UFUNCTION() void OnConstructed(AFGBuildable* Buildable);
    UFUNCTION() void OnRemoved(AFGBuildable* Buildable);
    void LogEvent(const foreman::Event& Event, double Started) const;
    TUniquePtr<foreman::State> State;
    TUniquePtr<foreman::Delivery> Delivery;
    TUniquePtr<FBridgeTransport> Transport;
    uint64 LifetimeGeneration=0;
    FTimerHandle PumpTimer;
    TMap<int32,double> LastError;
    TWeakObjectPtr<AFGBuildableSubsystem> Buildables;
    TMap<TWeakObjectPtr<AFGBuildable>, FString> Entities;
    FTimerHandle ReadyTimer;
    FDelegateHandle TearDownHandle;
    FString Epoch;
    uint64 LatestSeq = 0;
    bool Closing = false;
    bool Ready = false;
    bool UnresolvedRemoval = false;
};
