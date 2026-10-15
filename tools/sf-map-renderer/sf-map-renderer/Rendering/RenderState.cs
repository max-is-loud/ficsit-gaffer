// The mutable per-cell canvas the pipeline stages fill in turn: height grids, terrain colour,
// object masks and the water classification, as flat arrays.

using SfMapRenderer.Configuration;

namespace SfMapRenderer.Rendering;

/// <summary>
/// The mutable per-cell canvas the pipeline stages fill in turn: the height grid and its pre-rock
/// seabed snapshot, terrain colour, the wet-sand signal, object masks, and the water classification.
/// One flat array per signal, indexed <c>row * Width + column</c>.
/// </summary>
public sealed class RenderState
{
    public RenderState(WorldFrame frame)
    {
        Frame = frame;
        var cellCount = frame.Width * frame.Height;

        Height = new float[cellCount];
        Terrain = new byte[cellCount * 3];
        WetWeight = new byte[cellCount];
        IsRock = new bool[cellCount];
        ObjectKind = new byte[cellCount];
        ObjectColour = new byte[cellCount * 3];
        TrunkMask = new bool[cellCount];
        IsOcean = new bool[cellCount];
        IsLake = new bool[cellCount];
        IsRiver = new bool[cellCount];
        WaterZ = new double[cellCount];
        OceanVoid = new bool[cellCount];
        VolumeVoid = new bool[cellCount];
        BaseHeight = [];
    }

    public WorldFrame Frame { get; }

    /// <summary>Decoded 16-bit height, raised by the rock/flora pass (0 = void).</summary>
    public float[] Height { get; }

    /// <summary>Snapshot of <see cref="Height"/> after pass B, before rocks — the seabed the water is classified on.</summary>
    public float[] BaseHeight { get; private set; }

    /// <summary>Weight-blended terrain colour, three bytes per cell (0,0,0 = none).</summary>
    public byte[] Terrain { get; }

    /// <summary>Max WetSand/Puddles weight per cell — the game's water's-edge signal.</summary>
    public byte[] WetWeight { get; }

    /// <summary>A formation rises &gt; ~3 m here (drives the PROBEXY render prediction).</summary>
    public bool[] IsRock { get; }

    /// <summary>Height-ranked topmost object: 0 none · 1 rock · 2 coral · 3 tree foliage.</summary>
    public byte[] ObjectKind { get; }

    /// <summary>Per-family base colour of the topmost object (three bytes per cell, before hillshade; 0,0,0 = none).</summary>
    public byte[] ObjectColour { get; }

    /// <summary>A tree-trunk cross-section disc covers this cell.</summary>
    public bool[] TrunkMask { get; }

    public bool[] IsOcean { get; }
    public bool[] IsLake { get; }

    /// <summary>Flowing water (BP_River / waterfall channel) — rendered as a shallow thin sheet, not by depth.</summary>
    public bool[] IsRiver { get; }

    /// <summary>Surface Z of the water covering an ocean/lake cell.</summary>
    public double[] WaterZ { get; }

    /// <summary>Void connected to the map border (the real sea), versus inland data-gap void.</summary>
    public bool[] OceanVoid { get; }

    /// <summary>Void cells inside an ocean-band water volume — the authoritative ocean-vs-void signal.</summary>
    public bool[] VolumeVoid { get; }

    /// <summary>Cells nulled to void because they were landscape-visibility holes.</summary>
    public int VisibilityHoleCount { get; set; }

    /// <summary>Freezes the current height grid as the seabed, before the rock/flora pass raises it.</summary>
    public void SnapshotSeabed() => BaseHeight = (float[])Height.Clone();
}
