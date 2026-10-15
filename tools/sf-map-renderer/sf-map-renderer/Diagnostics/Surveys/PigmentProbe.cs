// Standalone survey: investigates the landscape material's world-aligned macro-variation
// (PigmentMap), dumping its size and parameters and writing the decoded texture to pigment.ppm.

using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Texture;

using SfMapRenderer.Assets;
using SfMapRenderer.Meshes;

using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Investigates the landscape material's world-aligned macro-variation ("PigmentMap"): dumps its size + the
/// scalar/switch parameters (looking for its tiling/scale), and writes the decoded texture to pigment.ppm so we
/// can eyeball whether it is the large-scale colour map that varies dune desert vs rocky desert vs beach.
/// </summary>
public static class PigmentProbe
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

                    var material = (export.GetOrDefault<UObject[]?>("MaterialInstances") ?? [])
                        .OfType<UUnrealMaterial>()
                        .FirstOrDefault();
                    if (material == null)
                    {
                        continue;
                    }

                    Dump(material);
                    Console.WriteLine("\nDONE");
                    return;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[skip] {cell}: {ex.Message}");
            }
        }

        Console.WriteLine("\nDONE (no landscape material found)");
    }

    private static void Dump(UUnrealMaterial material)
    {
        var parameters = new CMaterialParams2();
        material.GetParams(parameters, EMaterialFormat.AllLayers);

        Console.WriteLine("Scalars:");
        foreach (var (key, value) in parameters.Scalars.OrderBy(p => p.Key))
        {
            Console.WriteLine($"    {key,-44} = {value}");
        }

        Console.WriteLine("Switches:");
        foreach (var (key, value) in parameters.Switches.OrderBy(p => p.Key))
        {
            Console.WriteLine($"    {key,-44} = {value}");
        }

        foreach (var name in new[] { "PigmentMap", "HeatmapGradient", "Cell_Bombing_Noise_basecolor" })
        {
            if (parameters.Textures.TryGetValue(name, out var texObj) && texObj is UTexture2D texture)
            {
                var size = $"{texture.PlatformData?.SizeX}x{texture.PlatformData?.SizeY} {texture.Format}";
                Console.WriteLine($"\n{name}: {texture.Name}  {size}");
                if (name == "PigmentMap" && MaterialColourSampler.DecodeRgb(texture, 1024) is { } decoded)
                {
                    using var image = Image.LoadPixelData<Rgb24>(decoded.Rgb, decoded.Width, decoded.Height);
                    image.SaveAsPng("pigment.png");
                    Console.WriteLine($"  wrote pigment.png ({decoded.Width}x{decoded.Height})");
                }
            }
        }
    }
}
