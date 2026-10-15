// Standalone survey: reports the distribution of FGWaterVolume surface Z across the world.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>Distribution of FGWaterVolume surface Z (maxZ) across the world (was MODE=voldist).</summary>
public static class VolumeDistributionProbe
{
    public static void Report(GameAssetProvider assets)
    {
        var volumes = new List<(double SurfaceZ, double Depth, string Name)>();
        foreach (var package in assets.AllGameLevelPackages())
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(package).GetExports())
                {
                    if (export.ExportType != "FGWaterVolume")
                    {
                        continue;
                    }

                    var root = export.GetOrDefault<UObject?>("RootComponent");
                    if (root?.GetOrDefault<UObject?>("Brush") is not UModel brush || brush.Points is not { Length: > 0 } points)
                    {
                        continue;
                    }

                    var location = root.RelativeLocation();
                    var scale = root.RelativeScale();
                    double maxZ = -1e18, minZ = 1e18;
                    foreach (var p in points)
                    {
                        var z = location.Z + p.Z * scale.Z;
                        maxZ = Math.Max(maxZ, z);
                        minZ = Math.Min(minZ, z);
                    }

                    volumes.Add((maxZ, maxZ - minZ, export.Name));
                }
            }
            catch
            {
                // Skip a package that fails to load, as before.
            }
        }

        Console.WriteLine($"\n=== {volumes.Count} FGWaterVolumes — surfaceZ histogram (bucketed to 5cm) ===");
        foreach (var group in volumes.GroupBy(s => Math.Round(s.SurfaceZ / 5.0) * 5.0).OrderBy(g => g.Key))
        {
            Console.WriteLine($"  surfZ≈{group.Key,7:F0}  x{group.Count(),-4}  depths[{group.Min(s => s.Depth):F0}..{group.Max(s => s.Depth):F0}]");
        }

        Console.WriteLine("\n=== deep ocean-scale volumes (depth > 3000cm) surfZ values ===");
        foreach (var volume in volumes.Where(s => s.Depth > 3000).OrderBy(s => s.SurfaceZ))
        {
            Console.WriteLine($"  {volume.SurfaceZ,7:F0}  depth={volume.Depth,7:F0}  {volume.Name}");
        }

        Console.WriteLine("\nDONE");
    }
}
