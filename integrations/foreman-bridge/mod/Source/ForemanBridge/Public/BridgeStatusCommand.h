#pragma once
#include "Command/ChatCommandInstance.h"
#include "BridgeStatusCommand.generated.h"
UCLASS()
class FOREMANBRIDGE_API ABridgeStatusCommand : public AChatCommandInstance {
    GENERATED_BODY()
public:
    ABridgeStatusCommand();
    virtual EExecutionStatus ExecuteCommand_Implementation(UCommandSender* Sender, const TArray<FString>& Arguments, const FString& Label) override;
};
