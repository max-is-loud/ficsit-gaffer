using UnrealBuildTool;
using System.IO;

public class ForemanBridge : ModuleRules
{
    public ForemanBridge(ReadOnlyTargetRules Target) : base(Target)
    {
        AddEngineThirdPartyPrivateStaticDependencies(Target, "OpenSSL", "libcurl", "nghttp2", "zlib");
        PrivateDefinitions.Add("WITH_CURL=1");
        PrivateIncludePaths.Add(Path.Combine(EngineDirectory,"Source/Runtime/Online/HTTP/Private"));
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PrivateDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "FactoryGame", "SML", "CoreOnline", "Json", "Projects", "HTTP" });
    }
}
