// Standalone survey: tallies flora instances by component type and reports mesh paths planted from
// more than one source, which would render twice on the map.

using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Double-render audit: tallies flora-classified instances (meshes under /Foliage/Trees/, /Coral/ or /Bush/) by
/// component ExportType, and — for the trees/coral we render — reports how many distinct mesh paths appear in more
/// than one component type. Overlap there would mean the same species is planted from two sources (e.g. an HLOD
/// proxy alongside FGFoliage) and would double-render on the map.
/// </summary>
public static class FloraSourceProbe
{
    public static void Report(GameAssetProvider assets)
    {
        // meshPath -> (componentType -> instance count)
        var byMesh = new Dictionary<string, Dictionary<string, long>>(StringComparer.Ordinal);
        var byType = new Dictionary<string, long>(StringComparer.Ordinal);

        foreach (var cell in assets.GeneratedCellPackages().Concat(assets.AllGameLevelPackages()).Distinct())
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(cell).GetExports())
                {
                    var type = export.ExportType;
                    if (!type.Contains("StaticMeshComponent", StringComparison.Ordinal)
                        && !type.Contains("InstancedSMC", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var path = export.MeshIndex()?.ResolvedObject?.GetPathName()
                        ?? export.GetOrDefault<FPackageIndex?>("StaticMesh")?.ResolvedObject?.GetPathName();
                    if (path == null
                        || (!path.Contains("/Foliage/Trees/", StringComparison.Ordinal)
                            && !path.Contains("/Coral/", StringComparison.Ordinal)
                            && !path.Contains("/Bush/", StringComparison.Ordinal)))
                    {
                        continue;
                    }

                    long count = 1;
                    if (export is UInstancedStaticMeshComponent ism && ism.PerInstanceSMData is { Length: > 0 } inst)
                    {
                        count = inst.Length;
                    }
                    else if (export.GetOrDefault<FInstancedStaticMeshInstanceData[]?>("PerInstanceSMData") is { Length: > 0 } raw)
                    {
                        count = raw.Length;
                    }
                    else if (!export.HasRelativeLocation())
                    {
                        continue;
                    }

                    byType[type] = byType.GetValueOrDefault(type) + count;
                    if (!byMesh.TryGetValue(path, out var perType))
                    {
                        byMesh[path] = perType = new Dictionary<string, long>(StringComparer.Ordinal);
                    }

                    perType[type] = perType.GetValueOrDefault(type) + count;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[skip] {cell}: {ex.Message}");
            }
        }

        Console.WriteLine("\n=== flora instances by component type ===");
        foreach (var (type, n) in byType.OrderByDescending(p => p.Value))
        {
            Console.WriteLine($"  {n,9}  {type}");
        }

        var overlap = byMesh.Where(m => m.Value.Count > 1).ToList();
        Console.WriteLine($"\n=== meshes present in >1 component type (double-render risk): {overlap.Count} ===");
        foreach (var (path, perType) in overlap.OrderByDescending(m => m.Value.Values.Sum()).Take(25))
        {
            var name = path[(path.LastIndexOf('/') + 1)..];
            Console.WriteLine($"  {name}: " + string.Join(", ", perType.OrderByDescending(p => p.Value).Select(p => $"{p.Key}={p.Value}")));
        }

        Console.WriteLine($"\nDONE ({byMesh.Count} distinct flora meshes)");
    }
}
