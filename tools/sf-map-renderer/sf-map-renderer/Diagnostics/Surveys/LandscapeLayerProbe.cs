// Standalone survey: histograms the distinct landscape material layers across all generated cells.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>Histograms the distinct landscape material layers across all cells (was MODE=layers).</summary>
public static class LandscapeLayerProbe
{
    public static void Report(GameAssetProvider assets)
    {
        var cells = assets.GeneratedCellPackages();
        var counts = new Dictionary<string, int>();
        var processed = 0;
        foreach (var cell in cells)
        {
            if (++processed % 1000 == 0)
            {
                Console.WriteLine($"  ...{processed}/{cells.Count}");
            }

            try
            {
                foreach (var export in assets.Provider.LoadPackage(cell).GetExports())
                {
                    if (export.ExportType != "LandscapeComponent")
                    {
                        continue;
                    }

                    var allocations = export.GetOrDefault<FStructFallback[]>("WeightmapLayerAllocations") ?? [];
                    foreach (var allocation in allocations)
                    {
                        var name = allocation.GetOrDefault<UObject?>("LayerInfo")?.Name?.Replace("_LayerInfo", "", StringComparison.Ordinal) ?? "?";
                        counts[name] = counts.GetValueOrDefault(name) + 1;
                    }
                }
            }
            catch
            {
                // Skip a cell that fails to load, as before.
            }
        }

        Console.WriteLine("\n=== DISTINCT LANDSCAPE LAYERS ===");
        foreach (var (name, count) in counts.OrderByDescending(x => x.Value))
        {
            Console.WriteLine($"  {count,6}  {name}");
        }

        Console.WriteLine("\nDONE");
    }
}
