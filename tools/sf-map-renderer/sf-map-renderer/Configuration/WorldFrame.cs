// The world-centimetre coordinate frame shared by landscape, collectibles and biomes, and the
// output grid it maps onto. All world-to-cell and height-to-Z conversions live here.

namespace SfMapRenderer.Configuration;

/// <summary>
/// The world-cm coordinate frame shared by the landscape, collectibles and biomes (#239), together
/// with the downsampled output-raster grid it maps onto. All world↔cell and height↔Z conversions
/// live here so the maths exists in exactly one place.
/// </summary>
/// <remarks>
/// Landscape-to-world (probed from proxy root ∘ section base): <c>worldXY = Origin + SectionBase·100</c>.
/// The parent Landscape actor location is a red herring and is deliberately not used.
/// </remarks>
public sealed class WorldFrame
{
    /// <summary>World-cm origin of the landscape section grid (both axes).</summary>
    public const double OriginX = -50800.0;
    public const double OriginY = -50800.0;

    /// <summary>Centimetres per landscape quad (1 quad = 1 m).</summary>
    public const double Scale = 100.0;

    /// <summary>Height-texture midpoint and per-unit scale: <c>Z = actorZ + (h16 − Mid)·HeightScale·Scale</c>.</summary>
    public const double HeightMid = 32768.0;
    public const double HeightScale = 1.0 / 128.0;

    /// <summary>h16 units per world-cm — the inverse of <c>HeightScale·Scale</c>.</summary>
    public const double HeightUnitsPerCm = 128.0 / 100.0;

    /// <summary>Quads of ocean-frame margin added per side around the landscape extent.</summary>
    public const int PadQuads = 360;

    public WorldFrame(int downsample, int minSectionX, int minSectionY, int width, int height, double actorZ)
    {
        Downsample = downsample;
        MinSectionX = minSectionX;
        MinSectionY = minSectionY;
        Width = width;
        Height = height;
        ActorZ = actorZ;
    }

    /// <summary>Output-grid downsample factor (1 quad → <c>Downsample</c>×<c>Downsample</c> collapsed to one cell).</summary>
    public int Downsample { get; }

    /// <summary>Minimum section base (world grid, in quads), including the <see cref="PadQuads"/> margin.</summary>
    public int MinSectionX { get; }
    public int MinSectionY { get; }

    /// <summary>Output-raster dimensions in cells.</summary>
    public int Width { get; }
    public int Height { get; }

    /// <summary>Landscape actor Z (cm); uniform 100 across all proxies, plus any <c>ZADJ</c> offset.</summary>
    public double ActorZ { get; }

    /// <summary>Centimetres spanned by one output cell.</summary>
    public double CellWidthCm => Downsample * Scale;

    /// <summary>Decode a raw 16-bit height sample to a world-cm Z.</summary>
    public double HeightToZ(double height16) => ActorZ + (height16 - HeightMid) * HeightScale * Scale;

    /// <summary>Encode a world-cm Z back to a raw 16-bit height value.</summary>
    public double ZToHeight16(double z) => HeightMid + (z - ActorZ) * HeightUnitsPerCm;

    /// <summary>Fractional output column for a world-X (callers round, floor or ceil as the pass requires).</summary>
    public double FractionalColumn(double worldX) => ((worldX - OriginX) / Scale - MinSectionX) / Downsample;
    public double FractionalRow(double worldY) => ((worldY - OriginY) / Scale - MinSectionY) / Downsample;

    /// <summary>World-X at the origin of output column <paramref name="column"/>.</summary>
    public double WorldXAtColumn(int column) => OriginX + (MinSectionX + column * Downsample) * Scale;
    public double WorldYAtRow(int row) => OriginY + (MinSectionY + row * Downsample) * Scale;
}
