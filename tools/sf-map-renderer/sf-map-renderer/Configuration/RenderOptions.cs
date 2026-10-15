// Every render tunable in one typed class (downsample, rock and flora handling, ground cover, water
// and ocean levels), with defaults that reproduce the original tool's output, plus the tree-part
// and exclusion types.

namespace SfMapRenderer.Configuration;

/// <summary>Which sections of a tree mesh to rasterise.</summary>
public enum TreePart
{
    Both,
    Trunk,
    Foliage,
}

/// <summary>One placed rock instance to drop, matched by mesh name within ±100 m of an origin.</summary>
public readonly record struct RockExclusion(string MeshName, double X, double Y);

/// <summary>A world-XY rectangle used to force off-map void cells to ocean-blue.</summary>
public readonly record struct WorldRect(double X0, double Y0, double X1, double Y1);

/// <summary>
/// Every render tunable, in one typed place (each maps to a CLI option). Defaults reproduce the old
/// tool's environment-variable defaults exactly, so a default render is byte-identical.
/// </summary>
public sealed class RenderOptions
{
    /// <summary>Output downsample factor (<c>DS</c>). 8 = fast preview; 2 = full-res 3917×3409.</summary>
    public int Downsample { get; init; } = 8;

    /// <summary>Landscape Z offset (<c>ZADJ</c>) — left at 0; the historical "+51" was a mis-diagnosis.</summary>
    public double ZAdjust { get; init; }

    /// <summary>Rasterise <c>/Environment/Rock/</c> meshes (<c>ROCKS</c>).</summary>
    public bool RenderRocks { get; init; } = true;

    /// <summary>Per-instance rock exclusions (<c>ROCKEXCLUDEAT</c>).</summary>
    public IReadOnlyList<RockExclusion> RockExclusions { get; init; } = DefaultRockExclusions;

    /// <summary>Flora mesh-path substrings to render (<c>FLORA</c>); empty = flora off. Coral vs tree is
    /// decided by a <c>/Coral/</c> segment in the path.</summary>
    public IReadOnlyList<string> FloraFolders { get; init; } = DefaultFloraFolders;

    /// <summary>Flora colour cut in cm above the landscape (<c>FLORAH</c>) — low, so canopies fill.</summary>
    public double FloraColourHeightCm { get; init; } = 50.0;

    /// <summary>Strength (0..1) of the baked Landscape-Grass overlay on the terrain — colours the ground with the
    /// game's real per-vertex grass carpet (green Grass/Forest, red Red-Jungle, …) even where the weightmap is
    /// bare sand, reproducing the aerial look. 0 disables (and skips reading the baked grass data).</summary>
    public double GrassStrength { get; init; } = 1.0;

    /// <summary>Debug: paint the terrain purely by the baked Landscape-Grass data — each vertex flat-coloured by its
    /// dominant grass type (green grass, red grass, sand/pebble, gravel, …) — to see where the game bakes grass.</summary>
    public bool GrassDebug { get; init; }

    /// <summary>Strength (0..1) that dense ground-cover foliage (grass, ferns, small plants) tints the terrain
    /// toward its own colour — so vegetated ground (e.g. Jungle Spires tops) reads green from above instead of
    /// showing the bare sandy weightmap through sparse foliage. 0 disables.</summary>
    public double GroundCoverStrength { get; init; } = 0.9;

    /// <summary>Which tree sections to raise (<c>TREEPART</c>).</summary>
    public TreePart TreePart { get; init; } = TreePart.Both;

    /// <summary>Trunk-disc slice height in cm above the ground it touches (<c>TRUNKBAND</c>).</summary>
    public double TrunkBandCm { get; init; } = 250.0;

    /// <summary>Also emit the surface/object rasters + per-cell class byte (<c>LAYERS</c>).</summary>
    public bool EmitLayers { get; init; }

    /// <summary>Unified sea level for ocean-band water volumes (<c>OCEANZ</c>).</summary>
    public double OceanZ { get; init; } = -1730.0;

    /// <summary>Strength of the landscape macro-variation pigment overlay, 0 disables (<c>PIGMENT</c>).</summary>
    public double PigmentStrength { get; init; } = 0.6;

    /// <summary>Flood terrain that sits below sea level and connects to the ocean (<c>FLOODSUBSEA</c>) — fills
    /// under-water-flattened channels (e.g. the U10 cascade outflow) that carry no water actor.</summary>
    public bool FloodSubSea { get; init; } = true;

    /// <summary>Max depth below sea level a sub-sea cell may sit and still flood (cm). Keeps the fill to shallow
    /// coastal inlets/channels; deep dry basins the game leaves unflooded (Grass Fields, Blue Crater) are
    /// excluded because their floor drops far below sea level.</summary>
    public double SubSeaMaxDepthCm { get; init; } = 300.0;

    /// <summary>Connected channel water deeper than this (cm) and within <see cref="ChannelReachCm"/> of a river
    /// is rendered as flowing (light), so the steep banks match the mid-river ribbon instead of reading darker.
    /// Shallow water is already ~ribbon-light and is left to its depth shading.</summary>
    public double FlowingBankDepthCm { get; init; } = 250.0;

    /// <summary>How far from a river centreline (cm) the flowing treatment reaches — the max channel half-width.
    /// Bounds the spread so a deep lake merely touched by a river keeps its interior depth shading.</summary>
    public double ChannelReachCm { get; init; } = 5000.0;

    /// <summary>Per-instance rock colour jitter strength, 0 disables (<c>ROCKJITTER</c>).</summary>
    public double RockJitter { get; init; } = 0.18;

    /// <summary>World-XY rectangles forcing void cells ocean-blue (<c>BLUEBOX</c>).</summary>
    public IReadOnlyList<WorldRect> BlueBoxes { get; init; } = DefaultBlueBoxes;

    /// <summary>Region (coast east of the swamp + dune desert) where the deep-sea void is recoloured by distance
    /// to the coast, so the shallow coastal water fades smoothly to deep ocean blue extending east instead of
    /// meeting the flat void at a hard line. Null disables. Only void cells inside are touched.</summary>
    public WorldRect? EastFade { get; init; } = new(150000, -360000, 470000, 140000);

    /// <summary>Region (the SE, east of the swamp) where the captured seabed is ALSO faded into the deep gradient,
    /// so the blocky edge between visible-seabed shallow water and the flat void is smoothed. Kept south of the
    /// north void so that stays untouched. Null disables.</summary>
    public WorldRect? CapturedFade { get; init; } = new(240000, -120000, 470000, 140000);

    /// <summary>Distance from the coast (cm) over which the east fade reaches full deep ocean blue.</summary>
    public double EastFadeDistanceCm { get; init; } = 25000.0;

    /// <summary>Feather (cm) over which the east-fade region edge blends in, avoiding a hard boundary.</summary>
    public double EastFadeFeatherCm { get; init; } = 20000.0;

    /// <summary>Amplitude (0..1) + wavelength (cm) of low-frequency noise on the east fade, for natural variation.</summary>
    public double EastFadeNoise { get; init; } = 0.15;
    public double EastFadeNoiseWavelengthCm { get; init; } = 5000.0;

    /// <summary>Null landscape-visibility holes to void (<c>VISHOLE</c>) at weight ≥ <see cref="VisibilityThreshold"/>.</summary>
    public bool NullVisibilityHoles { get; init; } = true;
    public int VisibilityThreshold { get; init; } = 128;

    /// <summary>Stamp BP_River ribbons (<c>RIVERS</c>) of half-width <see cref="RiverHalfWidthCm"/> where terrain
    /// is at/below the river surface plus <see cref="RiverToleranceCm"/>.</summary>
    public bool RenderRivers { get; init; } = true;
    public double RiverHalfWidthCm { get; init; } = 200.0;
    public double RiverToleranceCm { get; init; } = 400.0;

    /// <summary>Wet-sand shallow shelf (<c>WETWATER</c> and its tunables).</summary>
    public bool WetWater { get; init; } = true;
    public double WetSeaZ { get; init; } = -1730.0;
    public double WetRiseCm { get; init; }
    public double WetDeepCm { get; init; } = 500.0;
    public int WetThreshold { get; init; } = 50;

    /// <summary>Ocean surface Z used for the land-elevation colour ramp fallback + the bounds sidecar (<c>SEA</c>).</summary>
    public double SeaLevelZ { get; init; } = -1646.0;

    // The full world flora: everything under /Environment/Foliage/ (Coral, Trees, Grass, Flowers, and all
    // /SmallFoliage/ — ferns, bushes, roots) plus the large bushes under /Environment/Bush/. ~2.6M instances,
    // ~2 min full-res; the FGFoliage decode (base-map-foliage-decode.md) is what makes this affordable. A
    // /Coral/ segment marks coral; everything else renders as the tree kind (leafy, sampled albedo). Narrow
    // with --flora (e.g. "/Foliage/Trees/,/Environment/Bush/") for a trees-only map.
    private static readonly string[] DefaultFloraFolders =
        ["/Environment/Foliage/", "/Environment/Bush/"];

    // The settled ~15-instance off-map cliff list: east column, SE corner, bottom strip, north edge.
    private static readonly RockExclusion[] DefaultRockExclusions =
    [
        new("CliffFormation_05", 418204, 92745),
        new("CliffFormation_05", 612135, 252648),
        new("CaveSplitter_01", 428654, -181910),
        new("CaveSplitter_01", 428083, -81758),
        new("CaveSplitter_01", 429599, -127807),
        new("CaveSplitter_01", 426951, -233372),
        new("CaveSplitter_01", 540008, -33723),
        new("CliffFormation_05", 227628, 389675),
        new("CliffPillar_01", 378630, 334237),
        new("CaveSplitter_01", 117941, -327752),
        new("CaveSplitter_01", 108671, -358332),
        new("CaveSplitter_01", 74971, -329122),
        new("CaveSplitter_01", 467211, -200017),
        new("CliffPillar_01", 454008, 64780),
        new("CliffPillar_01", 467213, 72703),
    ];

    // The far-west frame margin (cols A-B + C33/C34) that the FGWaterVolume footprints don't quite reach.
    private static readonly WorldRect[] DefaultBlueBoxes =
    [
        new(-340800, -340800, -301630, 340968),
        new(-301630, 300864, -282045, 340968),
    ];
}
