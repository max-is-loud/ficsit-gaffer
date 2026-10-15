// Entry point of sf-map-renderer: registers the render, probe, overlay and layers commands with the
// Spectre.Console command app.

using SfMapRenderer.Commands;

using Spectre.Console.Cli;

// Entry point — a thin table of contents. Each command reads its own typed settings, mounts the game-asset
// provider, and calls into the pipeline, artifact builders, or diagnostic probes.
var app = new CommandApp();
app.Configure(config =>
{
    config.SetApplicationName("sf-map-renderer");
    config.AddCommand<RenderCommand>("render")
        .WithDescription("Render the base map to the working directory (with optional ride-along probes).")
        .WithExample("render", "--downsample", "2", "--layers")
        .WithExample("render", "--downsample", "8", "--no-rocks", "--no-wet-sand")
        .WithExample("render", "--downsample", "8", "--probe-xy", "36210,-195420");
    config.AddCommand<ProbeCommand>("probe")
        .WithDescription("Run a standalone diagnostic survey against the game assets.")
        .WithExample("probe", "meshes")
        .WithExample("probe", "volat", "--at", "-100000,-300000")
        .WithExample("probe", "objectsat", "--at", "36210,-195420", "--radius", "30000", "--list");
    config.AddCommand<OverlayCommand>("overlay")
        .WithDescription("Annotate a flat render with biome outlines/names + a coordinate grid.")
        .WithExample("overlay", "map.ppm");
    config.AddCommand<LayersCommand>("layers")
        .WithDescription("Build the interactive layered HTML artifact from a LAYERS render.")
        .WithExample("layers", "--width", "1600");
});

return app.Run(args);
