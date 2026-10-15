// Samples the landscape material's world-aligned macro-variation colour map (PigmentMap) to tint
// terrain and rock regionally, scaled by a strength setting.

using CUE4Parse.UE4.Assets.Exports.Texture;

using SfMapRenderer.Meshes;

namespace SfMapRenderer.Landscape;

/// <summary>
/// The landscape material's world-aligned macro-variation ("PigmentMap"): a 1024² colour map sampled across the
/// whole landscape (its "LandscapeCoords" switch is set), mostly white (neutral) with large tinted regions — a
/// salmon Dune Desert, a mauve Red Jungle, a blue Blue Crater. Multiplying the terrain colour by it reproduces
/// the regional variation a single flat per-layer colour can't (orange dune vs plain rocky desert). The strength
/// scales how far each cell moves from neutral toward the pigment.
/// </summary>
public sealed class MacroPigment
{
    private readonly byte[]? _rgb;
    private readonly int _width;
    private readonly int _height;
    private readonly double _strength;

    public MacroPigment(UUnrealMaterial? landscapeMaterial, double strength)
    {
        _strength = strength;
        if (landscapeMaterial == null || strength <= 0)
        {
            return;
        }

        try
        {
            var parameters = new CMaterialParams2();
            landscapeMaterial.GetParams(parameters, EMaterialFormat.AllLayers);
            if (parameters.Textures.TryGetValue("PigmentMap", out var texture)
                && texture is UTexture2D pigment
                && MaterialColourSampler.DecodeRgb(pigment, 1024) is { } decoded)
            {
                _rgb = decoded.Rgb;
                _width = decoded.Width;
                _height = decoded.Height;
            }
        }
        catch
        {
            // No pigment available; Apply is then a no-op.
        }
    }

    public bool Available => _rgb != null;

    /// <summary>Tint a terrain colour by the pigment at landscape UV (u,v) ∈ [0,1].</summary>
    public (byte R, byte G, byte B) Apply((byte R, byte G, byte B) colour, double u, double v)
    {
        if (_rgb == null)
        {
            return colour;
        }

        var px = Math.Clamp((int)(u * _width), 0, _width - 1);
        var py = Math.Clamp((int)(v * _height), 0, _height - 1);
        var i = (py * _width + px) * 3;

        return (Channel(colour.R, _rgb[i]), Channel(colour.G, _rgb[i + 1]), Channel(colour.B, _rgb[i + 2]));
    }

    // Multiply the channel toward the pigment, scaled by strength: pigment white (255) leaves it unchanged.
    private byte Channel(byte terrain, byte pigment)
    {
        var factor = 1.0 - _strength * (1.0 - pigment / 255.0);
        return (byte)Math.Clamp(terrain * factor, 0, 255);
    }
}
