// Samples a representative albedo colour for a material by decoding a small mip of its diffuse
// texture and averaging the opaque pixels, caching the result per material.

using AssetRipper.TextureDecoder.Bc;
using AssetRipper.TextureDecoder.Rgb.Formats;

using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.Texture;

namespace SfMapRenderer.Meshes;

/// <summary>
/// Samples a representative albedo colour for a material: finds its diffuse texture, decodes a small mip (BC/DXT
/// via the managed AssetRipper decoder, or a raw BGRA/RGBA mip), and averages the opaque pixels — so a mesh
/// renders in its real colour instead of a hand-picked placeholder. Cached by material path (many meshes share
/// a material). Returns null when there is no usable texture or the decode fails, so the caller can fall back
/// to the placeholder palette.
/// </summary>
public sealed class MaterialColourSampler
{
    // Alpha below this is background (leaf/coral cards are alpha-cut) and skipped from the average.
    private const byte OpaqueThreshold = 128;

    private readonly Dictionary<string, (byte R, byte G, byte B)?> _cache = [];

    public int Count => _cache.Count;

    public (byte R, byte G, byte B)? Sample(UUnrealMaterial? material)
    {
        if (material == null)
        {
            return null;
        }

        var key = material.GetPathName();
        if (_cache.TryGetValue(key, out var cached))
        {
            return cached;
        }

        var result = Compute(material);
        _cache[key] = result;
        return result;
    }

    // Vector base-colour params to fall back on when no diffuse texture decodes (e.g. DesertRock's virtual-
    // textured blend material). Skipped when the value is a near-white/near-black tint multiplier default.
    private static readonly string[] BaseColourParams =
        ["Rock Base Color", "BaseColor", "Base Color", "Base Colour", "Diffuse Color", "DiffuseColor", "Albedo Color"];

    // The named albedo texture parameters that carry a mesh's REAL per-species base colour. Satisfactory's foliage/
    // rock proxy materials share a generic first texture (e.g. TX_Grass_01_BC) but route the true albedo through
    // these params — so a blue crater grass reads blue, pink grass pink, etc. Preferred over the first texture.
    private static readonly string[] AlbedoTextureParams = ["PM_Diffuse", "Grass Albedo", "Albedo"];

    private static (byte R, byte G, byte B)? Compute(UUnrealMaterial material)
    {
        try
        {
            var parameters = new CMaterialParams2();
            material.GetParams(parameters, EMaterialFormat.AllLayers);

            UTexture2D? texture2d = null;
            foreach (var name in AlbedoTextureParams)
            {
                if (parameters.Textures.TryGetValue(name, out var named) && named is UTexture2D namedTexture)
                {
                    texture2d = namedTexture;
                    break;
                }
            }

            texture2d ??= (parameters.TryGetTexture2d(out var texture, CMaterialParams2.Diffuse[0]) || parameters.TryGetFirstTexture2d(out texture))
                ? texture as UTexture2D
                : null;

            if (texture2d != null && AverageTexture(texture2d) is { } sampled)
            {
                return sampled;
            }

            return TryVectorColour(parameters);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Decode a texture to an interleaved RGB grid at the largest mip no wider than <paramref name="maxDim"/>
    /// (or the smallest available mip if all exceed it). Used to sample a world-aligned map per cell.
    /// </summary>
    public static (byte[] Rgb, int Width, int Height)? DecodeRgb(UTexture2D texture, int maxDim)
    {
        var mips = texture.PlatformData?.Mips;
        if (mips is not { Length: > 0 })
        {
            return null;
        }

        FTexture2DMipMap? chosen = null, smallest = null;
        foreach (var mip in mips)
        {
            if (mip?.BulkData?.Data is not { Length: > 0 } || mip.SizeX < 4 || mip.SizeY < 4)
            {
                continue;
            }

            if (mip.SizeX <= maxDim && (chosen == null || mip.SizeX > chosen.SizeX))
            {
                chosen = mip;
            }

            if (smallest == null || mip.SizeX < smallest.SizeX)
            {
                smallest = mip;
            }
        }

        chosen ??= smallest;
        if (chosen?.BulkData?.Data is not { Length: > 0 } bytes
            || !TryDecode(texture.Format, bytes, chosen.SizeX, chosen.SizeY, out var pixels, out var bgra))
        {
            return null;
        }

        var rgb = new byte[chosen.SizeX * chosen.SizeY * 3];
        int rIndex = bgra ? 2 : 0, bIndex = bgra ? 0 : 2;
        for (int src = 0, dst = 0; src + 3 < pixels.Length && dst + 2 < rgb.Length; src += 4, dst += 3)
        {
            rgb[dst] = pixels[src + rIndex];
            rgb[dst + 1] = pixels[src + 1];
            rgb[dst + 2] = pixels[src + bIndex];
        }

        return (rgb, chosen.SizeX, chosen.SizeY);
    }

    /// <summary>Average opaque albedo of a texture (decodes a small mip), or null if it cannot be decoded.</summary>
    public static (byte R, byte G, byte B)? AverageTexture(UTexture2D texture)
    {
        if (PickSmallMip(texture) is { BulkData.Data: { Length: > 0 } bytes } mip
            && TryDecode(texture.Format, bytes, mip.SizeX, mip.SizeY, out var rgba, out var bgra))
        {
            return Average(rgba, bgra);
        }

        return null;
    }

    /// <summary>A base-colour vector parameter (sRGB-encoded), ignoring near-white/near-black tint defaults.</summary>
    private static (byte R, byte G, byte B)? TryVectorColour(CMaterialParams2 parameters)
    {
        foreach (var name in BaseColourParams)
        {
            if (!parameters.Colors.TryGetValue(name, out var linear))
            {
                continue;
            }

            byte r = ToSrgb(linear.R), g = ToSrgb(linear.G), b = ToSrgb(linear.B);
            var max = Math.Max(r, Math.Max(g, b));
            var min = Math.Min(r, Math.Min(g, b));
            if (max < 20 || min > 235)
            {
                continue; // a black or white multiplier default, not a real colour
            }

            return (r, g, b);
        }

        return null;
    }

    private static byte ToSrgb(float linear) =>
        (byte)Math.Clamp(Math.Pow(Math.Clamp(linear, 0f, 1f), 1.0 / 2.2) * 255.0, 0, 255);

    /// <summary>The smallest cooked mip that still has real pixels — plenty for an average and cheap to decode.</summary>
    private static FTexture2DMipMap? PickSmallMip(UTexture2D texture)
    {
        var mips = texture.PlatformData?.Mips;
        if (mips is not { Length: > 0 })
        {
            return null;
        }

        FTexture2DMipMap? best = null;
        foreach (var mip in mips)
        {
            if (mip?.BulkData?.Data is not { Length: > 0 } || mip.SizeX < 4 || mip.SizeY < 4)
            {
                continue;
            }

            if (best == null || mip.SizeX < best.SizeX)
            {
                best = mip;
            }
        }

        return best;
    }

    /// <summary>Decode the common Satisfactory desktop formats to an interleaved 4-byte pixel buffer.</summary>
    private static bool TryDecode(EPixelFormat format, byte[] bytes, int width, int height, out byte[] pixels, out bool bgra)
    {
        bgra = false;
        pixels = [];
        switch (format)
        {
            case EPixelFormat.PF_DXT1:
                Bc1.Decompress<ColorRGBA<byte>, byte>(bytes, width, height, out pixels);
                return true;
            case EPixelFormat.PF_DXT3:
                Bc2.Decompress<ColorRGBA<byte>, byte>(bytes, width, height, out pixels);
                return true;
            case EPixelFormat.PF_DXT5:
                Bc3.Decompress<ColorRGBA<byte>, byte>(bytes, width, height, out pixels);
                return true;
            case EPixelFormat.PF_BC7:
                Bc7.Decompress<ColorRGBA<byte>, byte>(bytes, width.Align4(), height.Align4(), out pixels);
                return true;
            case EPixelFormat.PF_B8G8R8A8:
                pixels = bytes;
                bgra = true;
                return true;
            case EPixelFormat.PF_R8G8B8A8:
                pixels = bytes;
                return true;
            default:
                return false;
        }
    }

    /// <summary>Mean of the opaque pixels (falls back to all pixels if fully transparent).</summary>
    private static (byte R, byte G, byte B) Average(byte[] pixels, bool bgra)
    {
        int rIndex = bgra ? 2 : 0, bIndex = bgra ? 0 : 2;
        long r = 0, g = 0, b = 0, n = 0;
        for (var i = 0; i + 3 < pixels.Length; i += 4)
        {
            if (pixels[i + 3] < OpaqueThreshold)
            {
                continue;
            }

            r += pixels[i + rIndex];
            g += pixels[i + 1];
            b += pixels[i + bIndex];
            n++;
        }

        if (n == 0)
        {
            for (var i = 0; i + 3 < pixels.Length; i += 4)
            {
                r += pixels[i + rIndex];
                g += pixels[i + 1];
                b += pixels[i + bIndex];
                n++;
            }
        }

        return ((byte)(r / n), (byte)(g / n), (byte)(b / n));
    }
}

internal static class AlignExtensions
{
    public static int Align4(this int value) => (value + 3) & ~3;
}
