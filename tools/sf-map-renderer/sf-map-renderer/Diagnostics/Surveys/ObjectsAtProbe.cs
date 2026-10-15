// Standalone survey: reports the placed objects near each coordinate, as a histogram or a
// per-instance list.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>Reports the placed objects near each coordinate — histogram, or a per-instance list (was MODE=objectsat).</summary>
public static class ObjectsAtProbe
{
    public static void Report(
        GameAssetProvider assets,
        IReadOnlyList<(double X, double Y, string Label)> coordinates,
        double radius,
        bool list,
        bool tagMesh,
        bool includeAll)
    {
        var packages = assets.AllGameLevelPackages();
        var perPoint = coordinates.Select(_ => new Dictionary<string, int>()).ToList();
        var processed = 0;
        foreach (var package in packages)
        {
            if (++processed % 3000 == 0)
            {
                Console.WriteLine($"  ...{processed}/{packages.Count}");
            }

            try
            {
                foreach (var export in assets.Provider.LoadPackage(package).GetExports())
                {
                    FVector? location = export.HasRelativeLocation() ? export.RelativeLocation() : null;
                    if (location == null)
                    {
                        var root = export.GetOrDefault<UObject?>("RootComponent");
                        if (root != null && root.HasRelativeLocation())
                        {
                            location = root.RelativeLocation();
                        }
                    }

                    if (location == null)
                    {
                        continue;
                    }

                    var l = location.Value;
                    var type = export.ExportType;
                    if (!includeAll && (type.Contains("Landscape", StringComparison.Ordinal) || type.Contains("Foliage", StringComparison.Ordinal)))
                    {
                        continue;
                    }

                    var meshIndex = export.Properties.FirstOrDefault(p => p.Name.Text is "StaticMesh" or "mStaticMesh")?.Tag?.GenericValue as FPackageIndex;
                    var meshPath = meshIndex?.ResolvedObject?.GetPathName() ?? "";
                    var meshTag = meshPath.Length > 0
                        ? meshPath[(meshPath.IndexOf("/Environment/", StringComparison.Ordinal) is var ei && ei >= 0 ? ei : meshPath.LastIndexOf('/'))..]
                        : "";
                    if (tagMesh && meshTag.Length > 0)
                    {
                        type = $"{type} [{meshTag}]";
                    }

                    for (var k = 0; k < coordinates.Count; k++)
                    {
                        var distance = Math.Sqrt((l.X - coordinates[k].X) * (l.X - coordinates[k].X) + (l.Y - coordinates[k].Y) * (l.Y - coordinates[k].Y));
                        if (distance <= radius)
                        {
                            perPoint[k][type] = perPoint[k].GetValueOrDefault(type) + 1;
                            if (list && meshPath.Length > 0 && (includeAll || meshPath.Contains("/Environment/Rock/", StringComparison.Ordinal)))
                            {
                                var scale = export.RelativeScale();
                                Console.WriteLine($"  [{coordinates[k].Label}] d={distance:F0} {export.ExportType} {meshTag}@{l.X:F0},{l.Y:F0},{l.Z:F0} scale=({scale.X:F1},{scale.Y:F1},{scale.Z:F1})");
                            }
                        }
                    }
                }
            }
            catch
            {
                // Skip a package that fails to load, as before.
            }
        }

        for (var k = 0; k < coordinates.Count; k++)
        {
            Console.WriteLine($"\n=== {coordinates[k].Label} ({coordinates[k].X},{coordinates[k].Y}) within {radius / 100:F0}m ===");
            foreach (var (type, count) in perPoint[k].OrderByDescending(x => x.Value).Take(12))
            {
                Console.WriteLine($"  {count,3}x  {type}");
            }
        }

        Console.WriteLine("\nDONE");
    }
}
