// Standalone survey: histograms each landscape streaming proxy's root Z and scale Z, to confirm the
// height decode needs no per-proxy Z.

using System.Globalization;

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Histograms each LandscapeStreamingProxy's root Z and scale Z (and reports them near two key spots) to
/// confirm the height decode needs no per-proxy Z (was MODE=proxy).
/// </summary>
public static class ProxyProbe
{
    public static void Report(GameAssetProvider assets)
    {
        var proxies = new List<(double Z, double ScaleZ, double ScaleX, int SectionX, int SectionY, string Name)>();
        foreach (var cell in assets.GeneratedCellPackages())
        {
            try
            {
                var exports = assets.Provider.LoadPackage(cell).GetExports().ToList();
                var proxy = exports.FirstOrDefault(e => e.ExportType == "LandscapeStreamingProxy");
                if (proxy == null)
                {
                    continue;
                }

                var root = proxy.GetOrDefault<UObject?>("RootComponent");
                var location = root != null ? root.RelativeLocation() : new FVector(0, 0, 0);
                var scale = root != null ? root.RelativeScale() : new FVector(1, 1, 1);
                var components = exports
                    .Where(e => e.ExportType == "LandscapeComponent")
                    .Select(e => (X: e.GetOrDefault<int>("SectionBaseX"), Y: e.GetOrDefault<int>("SectionBaseY")))
                    .ToList();
                if (components.Count == 0)
                {
                    continue;
                }

                proxies.Add((location.Z, scale.Z, scale.X, components.Min(c => c.X), components.Min(c => c.Y), proxy.Name));
            }
            catch
            {
                // Skip a cell that fails to load, as before.
            }
        }

        Console.WriteLine($"\n=== {proxies.Count} proxies — rootLoc.Z histogram (5cm buckets) ===");
        foreach (var group in proxies.GroupBy(z => Math.Round(z.Z / 5.0) * 5.0).OrderBy(g => g.Key))
        {
            Console.WriteLine($"  rootLoc.Z≈{group.Key,7:F0}  x{group.Count()}");
        }

        Console.WriteLine("\n=== scale.Z histogram ===");
        foreach (var group in proxies.GroupBy(z => Math.Round(z.ScaleZ, 3)).OrderBy(g => g.Key))
        {
            Console.WriteLine($"  scale.Z={group.Key.ToString(CultureInfo.InvariantCulture)}  x{group.Count()}");
        }

        Console.WriteLine("\n=== proxy rootLoc.Z near key spots (SBX = (worldX+50800)/100) ===");
        foreach (var (worldX, worldY, tag) in new[] { (-279100.0, -156600.0, "WEST/B5"), (-37300.0, -229200.0, "SPIRE/H3") })
        {
            double sbx = (worldX + 50800) / 100, sby = (worldY + 50800) / 100;
            var hit = proxies
                .Where(z => sbx >= z.SectionX && sbx < z.SectionX + 128 * 8 && sby >= z.SectionY && sby < z.SectionY + 128 * 8)
                .OrderBy(z => Math.Abs(z.SectionX - sbx) + Math.Abs(z.SectionY - sby))
                .FirstOrDefault();
            Console.WriteLine($"  {tag} (SBX≈{sbx:F0},SBY≈{sby:F0}) -> proxy {hit.Name} rootLoc.Z={hit.Z:F0} scaleZ={hit.ScaleZ.ToString(CultureInfo.InvariantCulture)}");
        }

        Console.WriteLine("\nDONE");
    }
}
