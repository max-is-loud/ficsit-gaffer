// The render CLI command: mounts the game assets and runs RenderPipeline with the options and
// probes parsed from RenderSettings.

using SfMapRenderer.Pipeline;

using Spectre.Console.Cli;

namespace SfMapRenderer.Commands;

/// <summary>Renders the base map to the working directory, optionally with a diagnostic probe overlay.</summary>
public sealed class RenderCommand : Command<RenderSettings>
{
    protected override int Execute(CommandContext context, RenderSettings settings, CancellationToken cancellationToken)
    {
        using var assets = AssetMount.Open(settings);
        RenderPipeline.Run(assets, settings.ToRenderOptions(), settings.ToRenderProbes());
        return 0;
    }
}
