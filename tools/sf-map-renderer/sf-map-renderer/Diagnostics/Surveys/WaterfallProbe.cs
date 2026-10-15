// Standalone survey: dumps the structure of the waterfall tool actors nearest a coordinate, to
// decide how to render a waterfall's flowing water.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Dumps the structure of the BP_WaterFallTool actors nearest a coordinate — property tags, any spline-mesh
/// component array (as BP_River has), and child static-mesh component transforms — so we can decide how to
/// render a waterfall's flowing water (reuse the river spline path, or stamp a mesh footprint).
/// </summary>
public static class WaterfallProbe
{
    public static void Report(GameAssetProvider assets, double targetX, double targetY)
    {
        var packages = assets.AllGameLevelPackages();
        var hits = new List<(double Distance, UObject Export)>();
        foreach (var package in packages)
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(package).GetExports())
                {
                    if (!export.ExportType.Contains("WaterFall", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var root = export.GetOrDefault<UObject?>("RootComponent");
                    var loc = root != null && root.HasRelativeLocation() ? root.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
                    var d = Math.Sqrt((loc.X - targetX) * (loc.X - targetX) + (loc.Y - targetY) * (loc.Y - targetY));
                    if (d < 40000)
                    {
                        hits.Add((d, export));
                    }
                }
            }
            catch
            {
                // Skip a package that fails to load.
            }
        }

        foreach (var (distance, export) in hits.OrderBy(h => h.Distance).Take(40))
        {
            Dump(distance, export);
        }

        Console.WriteLine($"\nDONE ({hits.Count} falls in radius)");
    }

    private static void Dump(double distance, UObject export)
    {
        var root = export.GetOrDefault<UObject?>("RootComponent");
        if (root == null)
        {
            return;
        }

        var loc = root.RelativeLocation();
        var scale = root.RelativeScale();
        var yaw = root.RelativeYawRadians();
        double cos = Math.Cos(yaw), sin = Math.Sin(yaw);

        (double X, double Y, double Z) World(string compName)
        {
            var comp = export.GetOrDefault<UObject?>(compName);
            var rel = comp?.GetOrDefault<FVector>("RelativeLocation") ?? new FVector(0, 0, 0);
            double sx = rel.X * scale.X, sy = rel.Y * scale.Y;
            return (loc.X + sx * cos - sy * sin, loc.Y + sx * sin + sy * cos, loc.Z + rel.Z * scale.Z);
        }

        var top = World("Waterfall Top Center");
        var bottom = World("Waterfall Bottom Center");
        Console.WriteLine($"  {distance / 100,4:F0}m {export.Name,-46} W={export.GetOrDefault<int>("Width"),2} top=({top.X:F0},{top.Y:F0},{top.Z:F0}) bot=({bottom.X:F0},{bottom.Y:F0},{bottom.Z:F0})");
    }
}
