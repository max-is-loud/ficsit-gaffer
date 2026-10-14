#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "BridgeWorldModule.h"
#include "BridgeSubsystem.h"
#include "BridgeStatusCommand.h"
#include "BridgeGameAdapter.h"
#include "FGSaveInterface.h"
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBridgeProbeDefaults, "ForemanBridge.Probe.ServerOnly", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)
bool FBridgeProbeDefaults::RunTest(const FString&) {
    const auto* module = GetDefault<UBridgeWorldModule>();
    TestTrue(TEXT("Discoverable native root"), module->bRootModule);
    TestTrue(TEXT("Registers authoritative subsystem"), module->ModSubsystems.Contains(ABridgeSubsystem::StaticClass()));
    TestTrue(TEXT("Registers status command"), module->mChatCommands.Contains(ABridgeStatusCommand::StaticClass()));
    const auto* subsystem = GetDefault<ABridgeSubsystem>();
    TestTrue(TEXT("Spawns only on authority"), subsystem->ReplicationPolicy == ESubsystemReplicationPolicy::SpawnOnServer);
    TestFalse(TEXT("No custom subsystem replication"), subsystem->GetIsReplicated());
    TestFalse(TEXT("Not a save participant"), subsystem->GetClass()->ImplementsInterface(UFGSaveInterface::StaticClass()));
    auto* command = GetMutableDefault<ABridgeStatusCommand>();
    TestFalse(TEXT("No custom command replication"), command->GetIsReplicated());
    TestTrue(TEXT("Reject arbitrary command"), command->ExecuteCommand_Implementation(nullptr,{TEXT("other")},TEXT("foremanbridge")) == EExecutionStatus::BAD_ARGUMENTS);
    TestFalse(TEXT("Absent actor supplies no evidence"), BridgeGameAdapter::CaptureConstructor(nullptr).IsSet());
    TestFalse(TEXT("Absent world cannot dispatch chat"), BridgeGameAdapter::BroadcastPlainChat(nullptr,TEXT("test")));
    return true;
}
#endif
