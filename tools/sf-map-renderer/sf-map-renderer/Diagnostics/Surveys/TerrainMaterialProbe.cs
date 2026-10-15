// Standalone survey: dumps the first landscape component's material: property names, material
// chain, referenced textures and parameter names, to map each weightmap layer to a diffuse texture.

using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Assets.Objects;

using SfMapRenderer.Assets;
using SfMapRenderer.Meshes;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Dumps the landscape material of the first LandscapeComponent: its property names, the material chain, its
/// referenced textures, and the CMaterialParams2 texture/colour parameter names — so we can map each weightmap
/// layer (Sand, SandRock, Gravel, …) to a diffuse texture and sample its real albedo.
/// </summary>
public static class TerrainMaterialProbe
{
    public static void Report(GameAssetProvider assets)
    {
        foreach (var cell in assets.GeneratedCellPackages())
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(cell).GetExports())
                {
                    if (export.ExportType != "LandscapeComponent")
                    {
                        continue;
                    }

                    Console.WriteLine($"LandscapeComponent in {cell}\n  property tags:");
                    foreach (var prop in export.Properties)
                    {
                        Console.WriteLine($"    {prop.Name}  ({prop.PropertyType})");
                    }

                    var grassTypes = export.GetOrDefault<UObject[]?>("GrassTypes");
                    Console.WriteLine($"\n  GrassTypes: {grassTypes?.Length ?? 0}");
                    foreach (var gt in grassTypes ?? [])
                    {
                        Console.WriteLine($"    {gt?.Name} ({gt?.ExportType})");
                        var varieties = gt?.GetOrDefault<FStructFallback[]?>("GrassVarieties");
                        var sampler = new MaterialColourSampler();
                        foreach (var v in varieties ?? [])
                        {
                            var meshIdx = v.GetOrDefault<FPackageIndex?>("GrassMesh");
                            var meshPath = meshIdx?.ResolvedObject?.GetPathName();
                            (byte R, byte G, byte B)? albedo = null;
                            var colours = "";
                            if (meshIdx?.ResolvedObject?.Load() is UStaticMesh sm && sm.StaticMaterials is { Length: > 0 } mats
                                && mats[0].MaterialInterface?.Load() is UUnrealMaterial mat)
                            {
                                albedo = sampler.Sample(mat);
                                var mp = new CMaterialParams2();
                                try { mat.GetParams(mp, EMaterialFormat.AllLayers); } catch { }
                                colours = "mat=" + mat.Name + " tex=[" + string.Join(" ", mp.Textures.Select(kv =>
                                {
                                    var t2 = kv.Value as UTexture2D;
                                    var avg = t2 != null && MaterialColourSampler.AverageTexture(t2) is { } cc ? $"({cc.R},{cc.G},{cc.B})" : "";
                                    return $"{kv.Key}:{(kv.Value as UTexture2D)?.Name}{avg}";
                                })) + "]";
                            }

                            var name = meshPath != null ? meshPath[(meshPath.LastIndexOf('/') + 1)..] : "?";
                            Console.WriteLine($"        variety {name,-34} albedo={(albedo is { } c ? $"({c.R},{c.G},{c.B})" : "?")}  colourParams=[{colours}]");
                        }
                    }

                    foreach (var name in new[] { "MaterialInstances", "OverrideMaterials", "MaterialInstancesDynamic", "LandscapeMaterial", "Material" })
                    {
                        DumpMaterialProperty(export, name);
                    }

                    Console.WriteLine("\nDONE");
                    return;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[skip] {cell}: {ex.Message}");
            }
        }

        Console.WriteLine("\nDONE (no LandscapeComponent found)");
    }

    private static void DumpMaterialProperty(UObject export, string propertyName)
    {
        // A landscape material property may be a single object or an array of them.
        var single = export.GetOrDefault<UObject?>(propertyName);
        if (single is UUnrealMaterial oneMaterial)
        {
            DumpMaterial(propertyName, oneMaterial);
        }

        var array = export.GetOrDefault<UObject[]?>(propertyName);
        if (array != null)
        {
            for (var i = 0; i < array.Length; i++)
            {
                if (array[i] is UUnrealMaterial arrayMaterial)
                {
                    DumpMaterial($"{propertyName}[{i}]", arrayMaterial);
                }
            }
        }
    }

    private static void DumpMaterial(string label, UUnrealMaterial material)
    {
        Console.WriteLine($"\n=== {label}: {material.Name} ({material.GetType().Name}) ===");

        var textures = (material as UMaterial)?.ReferencedTextures;
        if (textures is { Count: > 0 })
        {
            Console.WriteLine("  ReferencedTextures:");
            foreach (var texture in textures)
            {
                if (texture is UTexture2D t)
                {
                    Console.WriteLine($"    {texture.Name,-48} {t.Format}  {t.PlatformData?.SizeX}x{t.PlatformData?.SizeY}");
                }
            }
        }

        try
        {
            var parameters = new CMaterialParams2();
            material.GetParams(parameters, EMaterialFormat.AllLayers);
            if (parameters.Textures.Count > 0)
            {
                Console.WriteLine("  CMaterialParams2 textures (albedo averages where decodable):");
                foreach (var (key, value) in parameters.Textures)
                {
                    var albedo = value is UTexture2D t2d && Meshes.MaterialColourSampler.AverageTexture(t2d) is { } c
                        ? $"avg ({c.R},{c.G},{c.B})"
                        : "";
                    Console.WriteLine($"    {key,-40} -> {(value as UTexture2D)?.Name ?? value?.Name,-40} {albedo}");
                }
            }

            if (parameters.Colors.Count > 0)
            {
                Console.WriteLine("  CMaterialParams2 colours:");
                foreach (var (key, value) in parameters.Colors)
                {
                    Console.WriteLine($"    {key,-40} -> ({value.R:0.00},{value.G:0.00},{value.B:0.00})");
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"    [params] {ex.Message}");
        }
    }
}
