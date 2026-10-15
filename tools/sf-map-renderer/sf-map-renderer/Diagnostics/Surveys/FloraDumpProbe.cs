// Standalone survey: shows how flora is placed (individual components or instanced foliage) and
// whether the instanced transforms can be read.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Surveys how flora is placed — individual components vs instanced foliage — and whether the instanced
/// transforms are readable (was MODE=floradump).
/// </summary>
public static class FloraDumpProbe
{
    private static readonly string[] DefaultFolders = ["/Foliage/Coral/", "/Foliage/Trees/"];

    public static void Report(GameAssetProvider assets, IReadOnlyList<string>? folders = null)
    {
        var want = folders ?? DefaultFolders;
        var cells = assets.GeneratedCellPackages();
        var byType = new Dictionary<string, int>();
        var instancedSamples = new List<string>();
        var processed = 0;
        foreach (var cell in cells)
        {
            if (++processed % 2000 == 0)
            {
                Console.WriteLine($"  ...{processed}/{cells.Count}");
            }

            try
            {
                foreach (var export in assets.Provider.LoadPackage(cell).GetExports())
                {
                    if (!export.ExportType.Contains("StaticMeshComponent", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var path = export.MeshIndex()?.ResolvedObject?.GetPathName();
                    if (path == null || !want.Any(w => path.Contains(w, StringComparison.Ordinal)))
                    {
                        continue;
                    }

                    var hasLocation = export.HasRelativeLocation();
                    var key = $"{export.ExportType}  loc={hasLocation}";
                    byType[key] = byType.GetValueOrDefault(key) + 1;

                    if (export.ExportType.Contains("Instanced", StringComparison.Ordinal) && instancedSamples.Count < 6)
                    {
                        string info;
                        if (export is UInstancedStaticMeshComponent instanced)
                        {
                            var count = instanced.PerInstanceSMData?.Length ?? -1;
                            var first = "";
                            if (count > 0)
                            {
                                var transform = instanced.PerInstanceSMData![0].TransformData;
                                first = $" inst0.T=({transform.Translation.X:F0},{transform.Translation.Y:F0},{transform.Translation.Z:F0}) scale={transform.Scale3D.X:F1}";
                            }

                            info = $"typed UInstancedStaticMeshComponent PerInstanceSMData.Length={count}{first}";
                        }
                        else
                        {
                            info = $"NOT a UInstancedStaticMeshComponent (runtime type {export.GetType().Name})";
                        }

                        instancedSamples.Add($"{path[(path.LastIndexOf('/') + 1)..]} [{export.ExportType}] -> {info}");
                    }
                }
            }
            catch
            {
                // Skip a cell that fails to load, as before.
            }
        }

        Console.WriteLine("\n=== flora component types (count · has RelativeLocation) ===");
        foreach (var (key, count) in byType.OrderByDescending(x => x.Value))
        {
            Console.WriteLine($"  {count,7}  {key}");
        }

        Console.WriteLine("\n=== instanced-component samples (can we read instances?) ===");
        foreach (var sample in instancedSamples)
        {
            Console.WriteLine($"  {sample}");
        }

        Console.WriteLine("\nDONE");
    }
}
