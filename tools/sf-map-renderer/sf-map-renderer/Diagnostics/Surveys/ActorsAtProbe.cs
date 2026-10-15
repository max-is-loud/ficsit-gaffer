// Standalone survey: an unfiltered census of every actor near a coordinate, with an ExportType
// histogram and the nearest water-like actors, for spotting water actor types not yet handled.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Unfiltered census of every actor near a coordinate: a full ExportType histogram plus, for anything whose
/// type/name/mesh hints at water, the closest instances. The definitive check for a water actor we don't yet
/// recognise (a differently-named stream/pond/spline tool) that only appears in one spot.
/// </summary>
public static class ActorsAtProbe
{
    private static readonly string[] WaterHints =
        ["water", "river", "fall", "stream", "pond", "lake", "splash", "wet", "flow", "current", "rapid", "cascade", "creek", "brook", "spring", "fluid", "liquid"];

    public static void Report(GameAssetProvider assets, double targetX, double targetY, double radius)
    {
        var histogram = new Dictionary<string, int>(StringComparer.Ordinal);
        var waterish = new List<(double Distance, string Text)>();
        var splines = new List<(double Distance, string Text)>();

        foreach (var package in assets.AllGameLevelPackages())
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(package).GetExports())
                {
                    var root = export.GetOrDefault<UObject?>("RootComponent");
                    FVector loc;
                    if (root != null && root.HasRelativeLocation())
                    {
                        loc = root.GetOrDefault<FVector>("RelativeLocation");
                    }
                    else if (export.HasRelativeLocation())
                    {
                        loc = export.GetOrDefault<FVector>("RelativeLocation");
                    }
                    else
                    {
                        continue;
                    }

                    var d = Math.Sqrt((loc.X - targetX) * (loc.X - targetX) + (loc.Y - targetY) * (loc.Y - targetY));
                    if (d > radius)
                    {
                        continue;
                    }

                    var type = export.ExportType;
                    histogram[type] = histogram.GetValueOrDefault(type) + 1;

                    var mesh = export.MeshIndex()?.ResolvedObject?.GetPathName() ?? "";
                    var haystack = $"{type} {export.Name} {mesh}".ToLowerInvariant();
                    if (WaterHints.Any(h => haystack.Contains(h)))
                    {
                        waterish.Add((d, $"{d / 100,5:F0}m  {type}  {export.Name}  loc=({loc.X:F0},{loc.Y:F0},{loc.Z:F0})  mesh={mesh[(mesh.LastIndexOf('/') + 1)..]}"));
                    }

                    if (type.Contains("Spline", StringComparison.OrdinalIgnoreCase) || type.Contains("Brush", StringComparison.OrdinalIgnoreCase) || type.Contains("Volume", StringComparison.OrdinalIgnoreCase))
                    {
                        var meshTail = mesh.Length > 0 ? mesh[(mesh.LastIndexOf('/') + 1)..] : "";
                        splines.Add((d, $"{d / 100,5:F0}m  {type}  {export.Name}  loc=({loc.X:F0},{loc.Y:F0},{loc.Z:F0})  mesh={meshTail}"));
                    }
                }
            }
            catch
            {
                // Skip a package that fails to load.
            }
        }

        Console.WriteLine($"\n=== water-hint actors within {radius / 100:F0}m of ({targetX:F0},{targetY:F0}) ===");
        foreach (var (_, text) in waterish.OrderBy(w => w.Distance).Take(30))
        {
            Console.WriteLine("  " + text);
        }

        Console.WriteLine($"\n=== spline/brush/volume actors within {radius / 100:F0}m (candidate hidden water) ===");
        foreach (var (_, text) in splines.OrderBy(s => s.Distance).Take(20))
        {
            Console.WriteLine("  " + text);
        }

        Console.WriteLine($"\n=== full ExportType histogram within {radius / 100:F0}m ===");
        foreach (var (type, count) in histogram.OrderByDescending(h => h.Value))
        {
            Console.WriteLine($"  {count,4}x  {type}");
        }

        Console.WriteLine("\nDONE");
    }
}
