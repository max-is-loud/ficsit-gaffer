#pragma once
#include "CoreMinimal.h"
#include "Core/BridgeTypes.h"
class AFGBuildable;
namespace BridgeGameAdapter {
    TOptional<foreman::Row> CaptureConstructor(AFGBuildable* Buildable);
    bool BroadcastPlainChat(UWorld* World, const FString& Text);
}
