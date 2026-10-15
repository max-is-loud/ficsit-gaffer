// Standalone survey: lists the root Z and scale Z of every water-plane and ocean volume in the
// persistent level.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>Lists the root Z (and scale Z) of every water-plane / ocean-volume in the persistent level (was MODE=sealevel).</summary>
public static class SeaLevelProbe
{
    public static void Report(GameAssetProvider assets)
    {
        Console.WriteLine("water-plane + ocean-volume Z (persistent level)...");
        foreach (var package in assets.PersistentLevelPackages())
        {
            foreach (var export in assets.Provider.LoadPackage(package).GetExports())
            {
                if (export.ExportType != "BP_WaterPlane_C" && export.ExportType != "FGWaterVolume" && export.ExportType != "BP_Water_C")
                {
                    continue;
                }

                var root = export.GetOrDefault<UObject?>("RootComponent") ?? export.GetOrDefault<UObject?>("DefaultSceneRoot");
                FVector? location = root != null && root.HasRelativeLocation() ? root.GetOrDefault<FVector>("RelativeLocation") : null;
                FVector? scale = root != null && root.Properties.Any(p => p.Name.Text == "RelativeScale3D") ? root.GetOrDefault<FVector>("RelativeScale3D") : null;
                var locationText = location == null ? "(default 0,0,0)" : $"({location.Value.X:F0},{location.Value.Y:F0},{location.Value.Z:F0})";
                var scaleText = scale == null ? "1" : $"{scale.Value.Z:F1}";
                Console.WriteLine($"  {export.ExportType,-18} {export.Name,-28} rootLoc={locationText} scale={scaleText}");
            }
        }

        Console.WriteLine("\nDONE");
    }
}
