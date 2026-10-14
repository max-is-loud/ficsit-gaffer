#pragma once
#include "CoreMinimal.h"
#include "BridgeConfig.h"
#include "Core/BridgeTypes.h"
class FBridgeTransport {
public:
    explicit FBridgeTransport(FBridgeConfig Config);
    ~FBridgeTransport();
    void Send(foreman::Request Request,TFunction<void(foreman::Outcome)> Callback);
    void CancelAll();
#if WITH_DEV_AUTOMATION_TESTS
    void SetDispatchTestHooks(TFunction<void()> Before, TFunction<void()> Dispatched);
#endif
private:
    struct FShared;
    TSharedPtr<FShared,ESPMode::ThreadSafe> Shared;
};
