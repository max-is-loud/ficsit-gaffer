// Standalone survey: histograms placed static meshes by folder and by asset name.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>Histograms placed StaticMesh assets by folder and by asset name (was MODE=meshes).</summary>
public static class MeshHistogramProbe
{
    public static void Report(GameAssetProvider assets)
    {
        var cells = assets.GeneratedCellPackages();
        var byFolder = new Dictionary<string, int>();
        var byAsset = new Dictionary<string, int>();
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
                    if (!export.ExportType.Contains("StaticMeshComponent", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var path = export.MeshIndex()?.ResolvedObject?.GetPathName();
                    if (path == null)
                    {
                        continue;
                    }

                    var dot = path.LastIndexOf('.');
                    if (dot > 0)
                    {
                        path = path[..dot];
                    }

                    var slash = path.LastIndexOf('/');
                    var folder = slash > 0 ? path[..slash] : path;
                    var asset = slash > 0 ? path[(slash + 1)..] : path;
                    byFolder[folder] = byFolder.GetValueOrDefault(folder) + 1;
                    byAsset[asset] = byAsset.GetValueOrDefault(asset) + 1;
                }
            }
            catch
            {
                // Skip a cell that fails to load, as before.
            }
        }

        Console.WriteLine("\n=== TOP FOLDERS (by placed-component count) ===");
        foreach (var (folder, count) in byFolder.OrderByDescending(x => x.Value).Take(35))
        {
            Console.WriteLine($"  {count,7}  {folder}");
        }

        Console.WriteLine("\n=== TOP ASSETS ===");
        foreach (var (asset, count) in byAsset.OrderByDescending(x => x.Value).Take(40))
        {
            Console.WriteLine($"  {count,7}  {asset}");
        }

        Console.WriteLine("\nDONE");
    }
}
