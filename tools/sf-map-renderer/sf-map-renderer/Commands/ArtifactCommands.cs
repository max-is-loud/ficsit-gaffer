// The overlay and layers CLI commands, with their settings and the default biomes.json path. Each
// hands its inputs to ReviewOverlayRenderer or LayeredMapArtifactBuilder.

using System.ComponentModel;

using SfMapRenderer.Artifacts;

using Spectre.Console.Cli;

namespace SfMapRenderer.Commands;

/// <summary>Default location of the canonical biome dataset (overridable).</summary>
public static class ArtifactDefaults
{
    public const string BiomesPath = @"D:\Code\StuartMeeks\ficsit-foreman\packages\sf-game-data\data\biomes.json";
}

public sealed class OverlaySettings : CommandSettings
{
    [CommandArgument(0, "<ppm>")]
    [Description("The flat render (map.ppm) to annotate.")]
    public string Ppm { get; init; } = "";

    [CommandOption("--biomes <PATH>")]
    [Description("Biome dataset (packages/sf-game-data/data/biomes.json).")]
    public string Biomes { get; init; } = ArtifactDefaults.BiomesPath;
}

/// <summary>Writes a labelled review image (biome outlines/names + coordinate grid) beside the render.</summary>
public sealed class OverlayCommand : Command<OverlaySettings>
{
    protected override int Execute(CommandContext context, OverlaySettings settings, CancellationToken cancellationToken)
    {
        ReviewOverlayRenderer.Render(settings.Ppm, settings.Biomes);
        return 0;
    }
}

public sealed class LayersSettings : CommandSettings
{
    [CommandOption("--width <PX>")]
    [Description("Target width of the artifact (default 1600).")]
    public int Width { get; init; } = 1600;

    [CommandOption("--surface <PATH>")]
    public string Surface { get; init; } = "map.surf.ppm";

    [CommandOption("--object <PATH>")]
    public string ObjectRaster { get; init; } = "map.obj.ppm";

    [CommandOption("--layers <PATH>")]
    public string LayersFile { get; init; } = "map.layers";

    [CommandOption("--biomes <PATH>")]
    public string Biomes { get; init; } = ArtifactDefaults.BiomesPath;
}

/// <summary>Builds the interactive layered HTML artifact from a LAYERS render.</summary>
public sealed class LayersCommand : Command<LayersSettings>
{
    protected override int Execute(CommandContext context, LayersSettings settings, CancellationToken cancellationToken)
    {
        LayeredMapArtifactBuilder.Build(settings.Surface, settings.ObjectRaster, settings.LayersFile, settings.Biomes, settings.Width);
        return 0;
    }
}
