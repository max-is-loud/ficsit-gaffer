// The probe CLI command: its settings, and the dispatch from a survey name to the matching probe in
// Diagnostics/Surveys, with coordinate and list parsing for the --at, --radius and --substr
// options.

using System.ComponentModel;
using System.Globalization;

using SfMapRenderer.Diagnostics.Surveys;

using Spectre.Console.Cli;

namespace SfMapRenderer.Commands;

/// <summary>Options for the standalone survey probes (a superset; each probe uses what it needs).</summary>
public sealed class ProbeSettings : AssetSettings
{
    [CommandArgument(0, "<name>")]
    [Description("Survey to run: meshes, landscape-layers, proxy, floradump, meshsections, meshinspect, volat, voldist, voldump, oceandump, oceanmesh, riverdump, pickupdump, nearwater, sealevel, objectsat.")]
    public string Name { get; init; } = "";

    [CommandOption("--at <LIST>")]
    [Description("Coordinate(s) the probe inspects, e.g. \"x,y;x,y\".")]
    public string? At { get; init; }

    [CommandOption("--radius <CM>")]
    [Description("Search radius (probe-specific default if unset).")]
    public double Radius { get; init; } = double.NaN;

    [CommandOption("--substr <TEXT>")]
    [Description("Mesh-path / family substring for meshinspect and meshsections.")]
    public string? Substr { get; init; }

    [CommandOption("--list")]
    [Description("objectsat: list each nearby placed instance.")]
    public bool List { get; init; }

    [CommandOption("--mesh")]
    [Description("objectsat: tag each type with its mesh folder.")]
    public bool TagMesh { get; init; }

    [CommandOption("--all")]
    [Description("objectsat: include landscape/foliage types.")]
    public bool All { get; init; }
}

/// <summary>Runs a standalone diagnostic survey against the game assets.</summary>
public sealed class ProbeCommand : Command<ProbeSettings>
{
    protected override int Execute(CommandContext context, ProbeSettings settings, CancellationToken cancellationToken)
    {
        using var assets = AssetMount.Open(settings);
        switch (settings.Name)
        {
            case "meshes": MeshHistogramProbe.Report(assets); break;
            case "landscape-layers": LandscapeLayerProbe.Report(assets); break;
            case "proxy": ProxyProbe.Report(assets); break;
            case "floradump": FloraDumpProbe.Report(assets); break;
            case "meshsections": MeshSectionProbe.Report(assets, ParseList(settings.Substr)); break;
            case "matcolour": MaterialColourProbe.Report(assets, ParseList(settings.Substr)); break;
            case "terrainmat": TerrainMaterialProbe.Report(assets); break;
            case "pigment": PigmentProbe.Report(assets); break;
            case "treeat":
                var (tax, tay) = ParseSingle(settings.At, 109300, -129300);
                TreeAtProbe.Report(assets, tax, tay, Radius(settings, 6000));
                break;
            case "florasrc": FloraSourceProbe.Report(assets); break;
            case "grassdata":
                var (gdx, gdy) = ParseSingle(settings.At, -140100, 157000);
                GrassDataProbe.Report(assets, gdx, gdy);
                break;
            case "waterfall":
                var (wfx, wfy) = ParseSingle(settings.At, 49963, -137409);
                WaterfallProbe.Report(assets, wfx, wfy);
                break;
            case "actorsat":
                var (aax, aay) = ParseSingle(settings.At, 57900, -148900);
                ActorsAtProbe.Report(assets, aax, aay, Radius(settings, 15000));
                break;
            case "meshinspect":
                var (mix, miy) = ParseSingle(settings.At, 178202, 250734);
                MeshInspectProbe.Report(assets, mix, miy, settings.Substr ?? "CoralTree", Radius(settings, 20000));
                break;
            case "volat": VolumeAtProbe.Report(assets, ParseCoordinates(settings.At)); break;
            case "voldist": VolumeDistributionProbe.Report(assets); break;
            case "voldump": VolumeDumpProbe.Report(assets); break;
            case "oceandump": OceanDumpProbe.Report(assets); break;
            case "oceanmesh": OceanMeshProbe.Report(assets); break;
            case "riverdump": RiverDumpProbe.Report(assets); break;
            case "nearwater":
                var (nwx, nwy) = ParseSingle(settings.At, 0, 0);
                NearWaterProbe.Report(assets, nwx, nwy);
                break;
            case "sealevel": SeaLevelProbe.Report(assets); break;
            case "pickupdump":
                var (pux, puy) = ParseSingle(settings.At, 0, 0);
                PickupDumpProbe.Report(assets, pux, puy, Radius(settings, 25000));
                break;
            case "objectsat":
                ObjectsAtProbe.Report(assets, ParseLabelledCoordinates(settings.At), Radius(settings, 30000), settings.List, settings.TagMesh, settings.All);
                break;
            default:
                Console.Error.WriteLine($"unknown probe '{settings.Name}'");
                return 1;
        }

        return 0;
    }

    private static double Radius(ProbeSettings settings, double fallback) => double.IsNaN(settings.Radius) ? fallback : settings.Radius;

    private static double Parse(string value) => double.Parse(value, CultureInfo.InvariantCulture);

    private static (double X, double Y) ParseSingle(string? value, double defaultX, double defaultY)
    {
        if (value == null)
        {
            return (defaultX, defaultY);
        }

        var parts = value.Split(',');
        return (Parse(parts[0]), Parse(parts[1]));
    }

    private static string[]? ParseList(string? value) =>
        value?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static IReadOnlyList<(double X, double Y)> ParseCoordinates(string? value) =>
        value == null
            ? []
            : [.. value.Split(';', StringSplitOptions.RemoveEmptyEntries).Select(segment => { var p = segment.Split(','); return (Parse(p[0]), Parse(p[1])); })];

    private static IReadOnlyList<(double X, double Y, string Label)> ParseLabelledCoordinates(string? value) =>
        value == null
            ? []
            : [.. value.Split(';', StringSplitOptions.RemoveEmptyEntries).Select(segment => { var p = segment.Split(','); return (Parse(p[0]), Parse(p[1]), p.Length > 2 ? p[2] : segment); })];
}
