// Derives each weightmap layer's terrain colour from the landscape material, by averaging its
// diffuse texture and applying the layer tint, and falls back to TerrainPalette for layers it
// cannot sample.

using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Math;

using SfMapRenderer.Meshes;

namespace SfMapRenderer.Landscape;

/// <summary>
/// Real per-layer terrain colours sampled from the landscape material: each weightmap layer maps to a diffuse
/// texture whose average albedo is multiplied by the layer's base-colour tint (both in linear space). This is
/// what makes the sand read as its true warm tone and the sand-rock its reddish sandstone, rather than a
/// hand-picked guess. Falls back to <see cref="TerrainPalette"/> for any layer we can't sample.
/// </summary>
public sealed class TerrainLayerColours
{
    // Ordered layer keyword -> (albedo texture param, optional base-colour tint param). More specific first,
    // since "Sand" is a substring of SandRock/SandPebbles/SandRipples/SandCracks/WetSand.
    private static readonly (string Layer, string Albedo, string? Tint)[] Map =
    [
        ("SandRock", "TX_SandRock_Alb_01", "Sand Rock BaseColor"),
        ("SandPebbles", "TX_SandPebbles_01_Alb", "Sand BaseColor"),
        ("SandRipples", "TX_SandRipples_BC", "Sand BaseColor"),
        ("SandCracks", "TX_Sand_BC", "Sand BaseColor"),
        ("WetSand", "TX_Sand_BC", "WetSand_Color"),
        ("Sand", "TX_Sand_BC", "Sand BaseColor"),
        ("Gravel", "Gravel_Alb", null),
        ("CoralRock", "TX_SeaRocks_01_Alb", null),
        ("Coral", "TX_SeaRocks_01_Alb", null),
        ("Soil", "TX_Soil_01_Alb", null),
        ("Dirt", "TX_Soil_01_Alb", null),
        ("Mud", "TX_Soil_01_Alb", null),
        ("RedJungle", "TX_Grass_RedJungle_01_Alb", null),
        ("GrassRed", "TX_GrassRed_01_Alb", null),
        ("Forest", "TX_Forest_01_Alb", null),
        ("Jungle", "TX_Forest_01_Alb", null),
        ("Grass", "TX_Grass_01_Alb", null),
        ("Moss", "TX_Grass_01_Alb", null),
        // The rare DesertRock terrain layer reads like sand-rock.
        ("DesertRock", "TX_SandRock_Alb_01", "Sand Rock BaseColor"),
    ];

    private readonly CMaterialParams2 _parameters = new();
    private readonly Dictionary<string, (byte R, byte G, byte B)> _cache = new(StringComparer.OrdinalIgnoreCase);

    public TerrainLayerColours(UUnrealMaterial? landscapeMaterial)
    {
        try
        {
            landscapeMaterial?.GetParams(_parameters, EMaterialFormat.AllLayers);
        }
        catch
        {
            // Leave the parameters empty; every layer then falls back to the palette.
        }
    }

    public (byte R, byte G, byte B) ColourFor(string layerName)
    {
        if (_cache.TryGetValue(layerName, out var cached))
        {
            return cached;
        }

        var result = Compute(layerName);
        _cache[layerName] = result;
        return result;
    }

    private (byte R, byte G, byte B) Compute(string layerName)
    {
        foreach (var (layer, albedo, tint) in Map)
        {
            if (!layerName.Contains(layer, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (_parameters.Textures.TryGetValue(albedo, out var texture)
                && texture is UTexture2D texture2d
                && MaterialColourSampler.AverageTexture(texture2d) is { } average)
            {
                FLinearColor? tintColour = tint != null && _parameters.Colors.TryGetValue(tint, out var value) ? value : null;
                return ApplyTint(average, tintColour);
            }

            break; // matched a layer but its texture didn't decode — fall back to the palette
        }

        return TerrainPalette.ColourFor(layerName);
    }

    /// <summary>Multiply the sampled albedo by the layer tint in linear space, then re-encode to sRGB.</summary>
    private static (byte R, byte G, byte B) ApplyTint((byte R, byte G, byte B) albedo, FLinearColor? tint)
    {
        if (tint is not { } t)
        {
            return albedo;
        }

        return (Channel(albedo.R, t.R), Channel(albedo.G, t.G), Channel(albedo.B, t.B));
    }

    private static byte Channel(byte srgb, float tint)
    {
        var linear = Math.Pow(Math.Clamp(srgb / 255.0, 0, 1), 2.2) * tint;
        return (byte)Math.Clamp(Math.Pow(Math.Clamp(linear, 0, 1), 1.0 / 2.2) * 255.0, 0, 255);
    }
}
