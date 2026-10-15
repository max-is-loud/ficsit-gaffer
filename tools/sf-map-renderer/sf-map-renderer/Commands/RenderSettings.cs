// CLI settings for the render command, one option per render tunable, plus the --probe-* diagnostic
// options. Converts them into RenderOptions and RenderProbes.

using System.ComponentModel;
using System.Globalization;

using SfMapRenderer.Configuration;
using SfMapRenderer.Pipeline;

using Spectre.Console.Cli;

namespace SfMapRenderer.Commands;

/// <summary>
/// Options for the <c>render</c> command. Each maps to one of the old environment variables with the same
/// default, so a bare <c>render</c> reproduces the default render exactly. The <c>--probe-*</c> options are
/// diagnostic overlays that ride on the render.
/// </summary>
public sealed class RenderSettings : AssetSettings
{
    [CommandOption("-d|--downsample <N>")]
    [Description("Output downsample factor (2 = full-res 3917x3409).")]
    public int Downsample { get; init; } = 8;

    [CommandOption("--z-adjust <CM>")]
    [Description("Landscape Z offset; leave 0.")]
    public double ZAdjust { get; init; }

    [CommandOption("--no-rocks")]
    [Description("Skip the rock/flora higher-ground pass.")]
    public bool NoRocks { get; init; }

    [CommandOption("--rock-exclude <LIST>")]
    [Description("Per-instance rock exclusions \"Mesh@x,y;...\" (default: the settled ~15).")]
    public string? RockExclude { get; init; }

    [CommandOption("--flora <LIST>")]
    [Description("Flora path substrings (comma-separated; \"off\" to disable).")]
    public string? Flora { get; init; }

    [CommandOption("--flora-height <CM>")]
    [Description("Flora colour cut, cm above the landscape.")]
    public double FloraHeight { get; init; } = 50.0;

    [CommandOption("--tree-part <PART>")]
    [Description("Tree sections to raise: both | trunk | foliage.")]
    public TreePart TreePart { get; init; } = TreePart.Both;

    [CommandOption("--trunk-band <CM>")]
    [Description("Trunk-disc slice height, cm above the ground it touches.")]
    public double TrunkBand { get; init; } = 250.0;

    [CommandOption("--layers")]
    [Description("Also emit map.surf.ppm + map.obj.ppm + map.layers.")]
    public bool Layers { get; init; }

    [CommandOption("--ocean-z <Z>")]
    [Description("Unified sea level for ocean-band water volumes.")]
    public double OceanZ { get; init; } = -1730.0;

    [CommandOption("--pigment <STRENGTH>")]
    [Description("Landscape macro-variation pigment overlay strength 0..1 (0 disables). Default 0.6.")]
    public double Pigment { get; init; } = 0.6;

    [CommandOption("--no-flood-sub-sea")]
    [Description("Do not flood below-sea-level terrain connected to the ocean.")]
    public bool NoFloodSubSea { get; init; }

    [CommandOption("--rock-jitter <STRENGTH>")]
    [Description("Per-instance rock colour jitter 0..1 (0 disables). Default 0.18.")]
    public double RockJitter { get; init; } = 0.18;

    [CommandOption("--ground-cover <STRENGTH>")]
    [Description("How strongly dense grass/small foliage tints the terrain green 0..1 (0 disables). Default 0.9.")]
    public double GroundCover { get; init; } = 0.9;

    [CommandOption("--grass <STRENGTH>")]
    [Description("Strength of the baked Landscape-Grass overlay on the terrain 0..1 (0 disables). Default 1.")]
    public double Grass { get; init; } = 1.0;

    [CommandOption("--grass-debug")]
    [Description("Debug: paint terrain by the baked grass data (dominant grass type per vertex). Use with --grass 1.")]
    public bool GrassDebug { get; init; }

    [CommandOption("--blue-box <LIST>")]
    [Description("World-XY rectangles forcing void to ocean-blue \"x0,y0,x1,y1;...\" (default: west margin).")]
    public string? BlueBox { get; init; }

    [CommandOption("--no-visibility-holes")]
    [Description("Do not null landscape-visibility holes to void.")]
    public bool NoVisibilityHoles { get; init; }

    [CommandOption("--visibility-threshold <N>")]
    [Description("Visibility-layer weight at/above which a cell becomes void.")]
    public int VisibilityThreshold { get; init; } = 128;

    [CommandOption("--no-rivers")]
    [Description("Skip BP_River ribbons.")]
    public bool NoRivers { get; init; }

    [CommandOption("--river-width <CM>")]
    [Description("River ribbon half-width at scale 1.")]
    public double RiverWidth { get; init; } = 200.0;

    [CommandOption("--river-tolerance <CM>")]
    [Description("Terrain-above-surface slack for river stamping.")]
    public double RiverTolerance { get; init; } = 400.0;

    [CommandOption("--no-wet-sand")]
    [Description("Skip the wet-sand shallow shelf.")]
    public bool NoWetSand { get; init; }

    [CommandOption("--wet-sea <Z>")]
    [Description("Wet-sand true water surface.")]
    public double WetSea { get; init; } = -1730.0;

    [CommandOption("--wet-rise <CM>")]
    [Description("Wet cells this far above sea still count.")]
    public double WetRise { get; init; }

    [CommandOption("--wet-deep <CM>")]
    [Description("Depth cap below sea for wet-sand shallows.")]
    public double WetDeep { get; init; } = 500.0;

    [CommandOption("--wet-threshold <N>")]
    [Description("WetSand/Puddles weight to seed the shelf.")]
    public int WetThreshold { get; init; } = 50;

    [CommandOption("--sea-level <Z>")]
    [Description("Ocean surface Z for the land colour ramp + bounds sidecar.")]
    public double SeaLevel { get; init; } = -1646.0;

    [CommandOption("--probe-xy <LIST>")]
    [Description("PROBEXY: per-coordinate land/water/void report \"x,y;...\".")]
    public string? ProbeXy { get; init; }

    [CommandOption("--rock-at <LIST>")]
    [Description("ROCKAT: which instances rasterise onto each cell \"x,y,label;...\".")]
    public string? RockAt { get; init; }

    [CommandOption("--cells <LIST>")]
    [Description("CELLS: land/sea/lake/void of named cells (A-T x 1-17), comma-separated.")]
    public string? Cells { get; init; }

    [CommandOption("--layer-at <LIST>")]
    [Description("LAYERAT: material-layer dump at coordinates \"x,y;...\".")]
    public string? LayerAt { get; init; }

    [CommandOption("--water-trace <XY>")]
    [Description("Trace which water pass/volume sets one cell's surface \"x,y\".")]
    public string? WaterTrace { get; init; }

    [CommandOption("--z-test")]
    [Description("ztest: compare decoded Z against the collectibles (see --world-locations).")]
    public bool ZTest { get; init; }

    [CommandOption("--world-locations <PATH>")]
    [Description("world-locations.json for --z-test.")]
    public string WorldLocations { get; init; } = @"D:\Code\StuartMeeks\ficsit-foreman\tools\fg-probe\world-locations.json";

    public RenderOptions ToRenderOptions() => new()
    {
        Downsample = Downsample,
        ZAdjust = ZAdjust,
        RenderRocks = !NoRocks,
        RockExclusions = RockExclude == null ? new RenderOptions().RockExclusions : ParseRockExclusions(RockExclude),
        FloraFolders = Flora == null ? new RenderOptions().FloraFolders : ParseFlora(Flora),
        FloraColourHeightCm = FloraHeight,
        TreePart = TreePart,
        TrunkBandCm = TrunkBand,
        EmitLayers = Layers,
        OceanZ = OceanZ,
        PigmentStrength = Pigment,
        RockJitter = RockJitter,
        GroundCoverStrength = GroundCover,
        GrassStrength = Grass,
        GrassDebug = GrassDebug,
        FloodSubSea = !NoFloodSubSea,
        BlueBoxes = BlueBox == null ? new RenderOptions().BlueBoxes : ParseBlueBoxes(BlueBox),
        NullVisibilityHoles = !NoVisibilityHoles,
        VisibilityThreshold = VisibilityThreshold,
        RenderRivers = !NoRivers,
        RiverHalfWidthCm = RiverWidth,
        RiverToleranceCm = RiverTolerance,
        WetWater = !NoWetSand,
        WetSeaZ = WetSea,
        WetRiseCm = WetRise,
        WetDeepCm = WetDeep,
        WetThreshold = WetThreshold,
        SeaLevelZ = SeaLevel,
    };

    public RenderProbes ToRenderProbes() => new()
    {
        PointXy = ParseCoordinates(ProbeXy),
        RockAt = ParseLabelledCoordinates(RockAt),
        Cells = Cells?.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(c => c.Trim()).ToList(),
        LayerAt = ParseCoordinates(LayerAt),
        ZTestPath = ZTest ? WorldLocations : null,
        WaterTrace = ParseCoordinates(WaterTrace)?.FirstOrDefault(),
    };

    private static double Parse(string value) => double.Parse(value, CultureInfo.InvariantCulture);

    private static List<(double X, double Y)>? ParseCoordinates(string? value)
    {
        if (value == null)
        {
            return null;
        }

        return value.Split(';', StringSplitOptions.RemoveEmptyEntries)
            .Select(segment =>
            {
                var parts = segment.Split(',');
                return (Parse(parts[0]), Parse(parts[1]));
            })
            .ToList();
    }

    private static List<(double X, double Y, string Label)>? ParseLabelledCoordinates(string? value)
    {
        if (value == null)
        {
            return null;
        }

        return value.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(segment =>
            {
                var parts = segment.Split(',');
                return (Parse(parts[0]), Parse(parts[1]), segment);
            })
            .ToList();
    }

    private static string[] ParseFlora(string value) =>
        value == "off" ? [] : value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static WorldRect[] ParseBlueBoxes(string value) =>
        [.. value.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(segment =>
            {
                var parts = segment.Split(',');
                return new WorldRect(Parse(parts[0]), Parse(parts[1]), Parse(parts[2]), Parse(parts[3]));
            })];

    private static RockExclusion[] ParseRockExclusions(string value) =>
        [.. value.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(segment =>
            {
                var at = segment.Split('@');
                var xy = at[1].Split(',');
                return new RockExclusion(at[0], Parse(xy[0]), Parse(xy[1]));
            })];
}
