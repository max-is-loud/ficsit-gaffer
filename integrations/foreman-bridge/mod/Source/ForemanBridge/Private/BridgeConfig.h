#pragma once
#include "CoreMinimal.h"
struct FBridgeConfig {
    bool Enabled=false;
    FString Url,Token,ServerId,WorldId,SessionName;
    bool MatchesSession(const FString& Name) const {return Enabled&&Name==SessionName;}
};
TOptional<FBridgeConfig> LoadBridgeConfig(FString AbsolutePath);
