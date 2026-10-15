// Standalone survey: samples and prints the average albedo of each material on the first mesh of
// named families, as a smoke test for texture decoding.

using CUE4Parse.UE4.Assets.Exports.Material;

using SfMapRenderer.Assets;
using SfMapRenderer.Meshes;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Samples and prints the average albedo colour of each material on the first mesh of the named families —
/// the smoke test for texture decoding (channel order, sane colours) before it feeds the render.
/// </summary>
public static class MaterialColourProbe
{
    private static readonly string[] DefaultFamilies =
        ["DesertRock", "Cliff", "Boulder", "Kapok", "GreenTree", "AmberTree", "TitanTree", "Coral"];

    public static void Report(GameAssetProvider assets, IReadOnlyList<string>? families = null)
    {
        var want = families ?? DefaultFamilies;
        var sampler = new MaterialColourSampler();
        var seen = new HashSet<string>();

        foreach (var cell in assets.GeneratedCellPackages())
        {
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

                    var name = path[(path.LastIndexOf('/') + 1)..].Split('.')[0];
                    if (!seen.Add(name))
                    {
                        continue;
                    }

                    if (export.MeshIndex()!.ResolvedObject?.Load() is not UStaticMesh mesh || mesh.StaticMaterials is not { } materials)
                    {
                        continue;
                    }

                    Console.WriteLine($"\n{name}");
                    foreach (var slot in materials)
                    {
                        var material = slot.MaterialInterface?.Load() as UUnrealMaterial;
                        var colour = sampler.Sample(material);
                        var materialName = slot.MaterialInterface?.Name ?? "?";
                        Console.WriteLine(colour is { } c
                            ? $"    {materialName,-40} -> albedo ({c.R},{c.G},{c.B})"
                            : $"    {materialName,-40} -> (no colour)");

                        if (material == null)
                        {
                            continue;
                        }

                        var mp = new CMaterialParams2();
                        try { material.GetParams(mp, EMaterialFormat.AllLayers); } catch { continue; }
                        foreach (var (key, value) in mp.Textures)
                        {
                            if (key.Contains("Emiss", StringComparison.OrdinalIgnoreCase) || key.Contains("Glow", StringComparison.OrdinalIgnoreCase))
                            {
                                var avg = value is CUE4Parse.UE4.Assets.Exports.Texture.UTexture2D t && MaterialColourSampler.AverageTexture(t) is { } cc ? $"({cc.R},{cc.G},{cc.B})" : "";
                                Console.WriteLine($"        TEX {key} = {(value as CUE4Parse.UE4.Assets.Exports.Texture.UTexture2D)?.Name} {avg}");
                            }
                        }

                        foreach (var (key, value) in mp.Colors)
                        {
                            if (key.Contains("Emiss", StringComparison.OrdinalIgnoreCase) || key.Contains("Glow", StringComparison.OrdinalIgnoreCase) || key.Contains("Color", StringComparison.OrdinalIgnoreCase) || key.Contains("Colour", StringComparison.OrdinalIgnoreCase))
                            {
                                Console.WriteLine($"        COL {key} = ({value.R:0.00},{value.G:0.00},{value.B:0.00})");
                            }
                        }
                    }

                    if (seen.Count >= want.Count)
                    {
                        Console.WriteLine("\nDONE");
                        return;
                    }
                }
            }
            catch
            {
                // Skip a cell that fails to load.
            }
        }

        Console.WriteLine("\nDONE");
    }
}
