#include "BridgeWorldModule.h"
#include "BridgeSubsystem.h"
#include "BridgeStatusCommand.h"
UBridgeWorldModule::UBridgeWorldModule() {
    bRootModule = true;
    ModSubsystems.Add(ABridgeSubsystem::StaticClass());
    mChatCommands.Add(ABridgeStatusCommand::StaticClass());
}
