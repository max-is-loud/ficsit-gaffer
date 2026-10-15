// Standalone survey: dumps the properties of item-pickup, hatcher and creature-spawner actors near
// a coordinate.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>Dumps the properties of item-pickup / hatcher / creature-spawner actors near a coordinate (was MODE=pickupdump).</summary>
public static class PickupDumpProbe
{
    public static void Report(GameAssetProvider assets, double targetX, double targetY, double radius)
    {
        var shown = 0;
        foreach (var package in assets.AllGameLevelPackages())
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(package).GetExports())
                {
                    if (export.ExportType != "FGItemPickup_Spawnable"
                        && !export.ExportType.Contains("Hatcher", StringComparison.Ordinal)
                        && !export.ExportType.Contains("CreatureSpawner", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    FVector? location = export.HasRelativeLocation()
                        ? export.RelativeLocation()
                        : export.GetOrDefault<UObject?>("RootComponent")?.GetOrDefault<FVector>("RelativeLocation");
                    if (location == null)
                    {
                        continue;
                    }

                    var l = location.Value;
                    if (Math.Sqrt((l.X - targetX) * (l.X - targetX) + (l.Y - targetY) * (l.Y - targetY)) > radius)
                    {
                        continue;
                    }

                    if (shown++ > 14)
                    {
                        Console.WriteLine("DONE");
                        return;
                    }

                    Console.WriteLine($"[{export.ExportType}] {export.Name} @({l.X:F0},{l.Y:F0},{l.Z:F0})");
                    foreach (var property in export.Properties)
                    {
                        Console.WriteLine($"    .{property.Name.Text} = {property.Tag?.GenericValue}");
                    }
                }
            }
            catch
            {
                // Skip a package that fails to load, as before.
            }
        }

        Console.WriteLine("DONE");
    }
}
