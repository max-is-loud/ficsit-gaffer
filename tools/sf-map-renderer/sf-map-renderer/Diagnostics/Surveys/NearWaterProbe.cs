// Standalone survey: lists the water-like actors nearest a coordinate.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>Lists the water-ish actors nearest a coordinate (was MODE=nearwater).</summary>
public static class NearWaterProbe
{
    public static void Report(GameAssetProvider assets, double targetX, double targetY)
    {
        var packages = assets.AllGameLevelPackages();
        var hits = new List<(double Distance, string Text)>();
        var processed = 0;
        foreach (var package in packages)
        {
            if (++processed % 2000 == 0)
            {
                Console.WriteLine($"  ...{processed}/{packages.Count}");
            }

            try
            {
                foreach (var export in assets.Provider.LoadPackage(package).GetExports())
                {
                    var type = export.ExportType;
                    var mesh = export.MeshIndex()?.ResolvedObject?.GetPathName() ?? "";
                    var isWaterish = type.Contains("Water", StringComparison.Ordinal) || type.Contains("River", StringComparison.Ordinal)
                        || type.Contains("Ocean", StringComparison.Ordinal) || mesh.Contains("Water", StringComparison.Ordinal) || mesh.Contains("River", StringComparison.Ordinal);
                    if (!isWaterish)
                    {
                        continue;
                    }

                    var root = export.GetOrDefault<UObject?>("RootComponent") ?? export.GetOrDefault<UObject?>("WaterSurface") ?? export.GetOrDefault<UObject?>("DefaultSceneRoot");
                    var location = root != null && root.HasRelativeLocation()
                        ? root.GetOrDefault<FVector>("RelativeLocation")
                        : export.HasRelativeLocation() ? export.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);
                    var distance = Math.Sqrt((location.X - targetX) * (location.X - targetX) + (location.Y - targetY) * (location.Y - targetY));
                    if (distance < 60000)
                    {
                        hits.Add((distance, $"{type}  {export.Name}  loc=({location.X:F0},{location.Y:F0},{location.Z:F0})  mesh={mesh[(mesh.LastIndexOf('/') + 1)..]}"));
                    }
                }
            }
            catch
            {
                // Skip a package that fails to load, as before.
            }
        }

        foreach (var (distance, text) in hits.OrderBy(h => h.Distance).Take(20))
        {
            Console.WriteLine($"  {distance / 100,5:F0}m  {text}");
        }

        Console.WriteLine("\nDONE");
    }
}
