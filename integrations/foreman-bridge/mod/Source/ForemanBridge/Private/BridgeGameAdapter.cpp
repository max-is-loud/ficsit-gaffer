#include "BridgeGameAdapter.h"
#include "Buildables/FGBuildable.h"
#include "FGChatManager.h"
#include "FGGameState.h"
#include "Engine/World.h"
#include "Misc/Guid.h"
#include "UObject/UnrealType.h"

DEFINE_LOG_CATEGORY_STATIC(LogForemanBridgeAdapter, Log, All);
namespace BridgeGameAdapter {
TOptional<foreman::Row> CaptureConstructor(AFGBuildable* Buildable) {
    check(IsInGameThread());
    if (!IsValid(Buildable) || !Buildable->HasAuthority()) { return {}; }
    bool IsConstructor = false;
    for (const UClass* Class = Buildable->GetClass(); Class; Class = Class->GetSuperClass()) {
        if (Class->GetPathName() == TEXT("/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C")) {
            IsConstructor = true; break;
        }
    }
    if (!IsConstructor) { return {}; }
    const FTransform Transform = Buildable->GetActorTransform();
    const FVector Position = Transform.GetLocation();
    const FRotator Rotation = Transform.Rotator();
    const FVector Scale = Transform.GetScale3D();
    if (Position.ContainsNaN() || Rotation.ContainsNaN() || Scale.ContainsNaN()) {
        UE_LOG(LogForemanBridgeAdapter, Error, TEXT("Constructor evidence rejected: non-finite transform"));
        return {};
    }
    foreman::Row Row;
    Row.entityId = TCHAR_TO_UTF8(*FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphensLower));
    Row.actorPath = TCHAR_TO_UTF8(*Buildable->GetPathName());
    Row.classPath = TCHAR_TO_UTF8(*Buildable->GetClass()->GetPathName());
    Row.transform.position = {Position.X, Position.Y, Position.Z};
    Row.transform.rotation = {Rotation.Pitch, Rotation.Yaw, Rotation.Roll};
    Row.transform.scale = {Scale.X, Scale.Y, Scale.Z};
    // The pinned accessor is protected; validate the reflected saved property.
    const FStructProperty* BuiltByProperty = FindFProperty<FStructProperty>(AFGBuildable::StaticClass(), TEXT("BuiltBy"));
    FPlayerInfoHandle BuiltBy;
    if (BuiltByProperty && BuiltByProperty->Struct == FPlayerInfoHandle::StaticStruct()) {
        BuiltBy = *BuiltByProperty->ContainerPtrToValuePtr<FPlayerInfoHandle>(Buildable);
    }
    const AFGGameState* GameState = Buildable->GetWorld()->GetGameState<AFGGameState>();
    const FCachedPlayerPlatformInfo* Info = GameState && BuiltBy.IsValid()
        ? GameState->FindPlayerPlatformInfoByHandle(BuiltBy, false) : nullptr;
    if (Info && Info->UniqueNetId.IsValid() && Info->UniqueNetId.GetType() != NAME_None) {
        Row.player = foreman::Player{TCHAR_TO_UTF8(*Info->UniqueNetId.GetType().ToString()),
            TCHAR_TO_UTF8(*Info->UniqueNetId.ToString()), TCHAR_TO_UTF8(*Info->PlayerName)};
    } else {
        UE_LOG(LogForemanBridgeAdapter, Verbose, TEXT("Constructor creator is null: built-by handle or matching platform cache unavailable"));
    }
    return Row;
}
bool BroadcastPlainChat(UWorld* World, const FString& Text) {
    check(IsInGameThread());
    if (!World || World->bIsTearingDown || World->GetNetMode() == NM_Client || World->GetNumPlayerControllers() == 0) { return false; }
    AFGChatManager* Chat = AFGChatManager::Get(World);
    if (!IsValid(Chat)) { return false; }
    FChatMessageStruct Message;
    Message.MessageText = FText::FromString(Text);
    Message.MessageType = EFGChatMessageType::CMT_SystemMessage;
    Chat->BroadcastChatMessage(Message);
    return true;
}
}
