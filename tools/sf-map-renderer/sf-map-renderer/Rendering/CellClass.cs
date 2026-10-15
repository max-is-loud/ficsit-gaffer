// Surface and object class enums, and the packing of a cell's class into the single byte stored in
// the map.layers sidecar.

namespace SfMapRenderer.Rendering;

/// <summary>Surface class of an output cell (bits 0–1 of the packed layer byte).</summary>
public enum SurfaceClass : byte
{
    /// <summary>Off-map void with no seabed and not inside an ocean volume.</summary>
    Void = 0,

    /// <summary>Water (ocean, lake, river, pond, wet-sand shelf) — or off-map void inside an ocean volume.</summary>
    Water = 1,

    /// <summary>Landscape terrain.</summary>
    Land = 2,
}

/// <summary>Height-ranked topmost object on a cell (bits 2–3 of the packed layer byte).</summary>
public enum ObjectKind : byte
{
    None = 0,
    Rock = 1,
    Coral = 2,
    Foliage = 3,
}

/// <summary>
/// Packs the per-cell layer class into a single byte for the <c>map.layers</c> sidecar:
/// bits 0–1 <see cref="SurfaceClass"/>, bits 2–3 <see cref="ObjectKind"/>, bit 4 = trunk-disc present.
/// </summary>
public static class CellClass
{
    private const int TrunkBit = 16;

    public static byte Pack(SurfaceClass surface, ObjectKind topmostObject, bool hasTrunkDisc)
    {
        var value = (byte)((byte)surface | ((byte)topmostObject << 2));
        if (hasTrunkDisc)
        {
            value |= TrunkBit;
        }

        return value;
    }

    /// <summary>
    /// Resolves the surface class from the raw signals, mirroring the render's own decision: a cell with no
    /// landscape and no water is void (ocean-blue only if it sits inside an ocean volume); otherwise water
    /// wins over land.
    /// </summary>
    public static SurfaceClass ResolveSurface(bool hasLandscape, bool isWater, bool isOceanVoid)
    {
        if (!hasLandscape && !isWater)
        {
            return isOceanVoid ? SurfaceClass.Water : SurfaceClass.Void;
        }

        return isWater ? SurfaceClass.Water : SurfaceClass.Land;
    }
}
