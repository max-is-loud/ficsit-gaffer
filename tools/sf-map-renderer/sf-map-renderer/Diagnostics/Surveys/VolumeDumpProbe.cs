// Standalone survey: transforms every FGWaterVolume brush to world space and writes its bounding
// box and surface Z to voldump.tsv.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>Transforms every FGWaterVolume brush to world and writes its AABB + surface Z to voldump.tsv (was MODE=voldump).</summary>
public static class VolumeDumpProbe
{
    public static void Report(GameAssetProvider assets)
    {
        var lines = new List<string>();
        foreach (var package in assets.PersistentLevelPackages())
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
                var yaw = root.RelativeYawRadians();
                double cos = Math.Cos(yaw), sin = Math.Sin(yaw);
                double minX = 1e18, maxX = -1e18, minY = 1e18, maxY = -1e18, minZ = 1e18, maxZ = -1e18;
                foreach (var p in points)
                {
                    double sx = p.X * scale.X, sy = p.Y * scale.Y, sz = p.Z * scale.Z;
                    double wx = location.X + sx * cos - sy * sin, wy = location.Y + sx * sin + sy * cos, wz = location.Z + sz;
                    minX = Math.Min(minX, wx);
                    maxX = Math.Max(maxX, wx);
                    minY = Math.Min(minY, wy);
                    maxY = Math.Max(maxY, wy);
                    minZ = Math.Min(minZ, wz);
                    maxZ = Math.Max(maxZ, wz);
                }

                lines.Add($"{export.Name}\t{points.Length}\t{minX:F0}\t{maxX:F0}\t{minY:F0}\t{maxY:F0}\t{minZ:F0}\t{maxZ:F0}");
            }
        }

        File.WriteAllLines(Path.Combine(Directory.GetCurrentDirectory(), "voldump.tsv"), lines);
        Console.WriteLine($"wrote voldump.tsv ({lines.Count} volumes)\nDONE");
    }
}
