#include "Modules/ModuleManager.h"
#include "Logging/LogMacros.h"

DEFINE_LOG_CATEGORY_STATIC(LogForemanBridge, Log, All);

class FForemanBridgeModule final : public IModuleInterface
{
public:
    virtual void StartupModule() override
    {
        UE_LOG(LogForemanBridge, Display, TEXT("ForemanBridge 0.1.0 authoritative constructor bridge; receiver disabled unless privately configured"));
    }
};

IMPLEMENT_MODULE(FForemanBridgeModule, ForemanBridge)
