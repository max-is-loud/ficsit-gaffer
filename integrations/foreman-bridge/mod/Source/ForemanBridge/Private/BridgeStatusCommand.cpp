#include "BridgeStatusCommand.h"
#include "BridgeSubsystem.h"
#include "Command/CommandSender.h"
#include "Subsystem/SubsystemActorManager.h"
ABridgeStatusCommand::ABridgeStatusCommand() {
    bReplicates = false;
    bNetLoadOnClient = false;
    CommandName = TEXT("foremanbridge");
    MinNumberOfArguments = 1;
    Usage = FText::FromString(TEXT("/foremanbridge status"));
}
EExecutionStatus ABridgeStatusCommand::ExecuteCommand_Implementation(UCommandSender* Sender, const TArray<FString>& Arguments, const FString&) {
    if (Arguments.Num()!=1 || Arguments[0]!=TEXT("status")) { return EExecutionStatus::BAD_ARGUMENTS; }
    if (!Sender || !GetWorld()) { return EExecutionStatus::UNCOMPLETED; }
    auto* Manager = GetWorld()->GetSubsystem<USubsystemActorManager>();
    auto* Bridge = Manager ? Manager->GetSubsystemActor<ABridgeSubsystem>() : nullptr;
    Sender->SendChatMessage(Bridge ? Bridge->Status() : TEXT("Foreman bridge: unavailable"));
    return EExecutionStatus::COMPLETED;
}
