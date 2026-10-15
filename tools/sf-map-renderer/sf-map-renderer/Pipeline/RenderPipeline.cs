// The ordered stages of a full render: collect the scene, build the grid frame, decode the
// landscape, raise rock and flora, lay the water model, shade and write the outputs, firing
// diagnostic probes at their stage.

using SfMapRenderer.Assets;
using SfMapRenderer.Collection;
using SfMapRenderer.Configuration;
using SfMapRenderer.Diagnostics;
using SfMapRenderer.Landscape;
using SfMapRenderer.Meshes;
using SfMapRenderer.Rendering;
using SfMapRenderer.Terrain;
using SfMapRenderer.Water;

namespace SfMapRenderer.Pipeline;

/// <summary>
/// The render pipeline — the table of contents for a full render. Runs pass A (collect), builds the grid
/// frame, decodes the landscape (pass B), raises rock/flora, lays the water model, then shades and writes
/// the outputs. Diagnostic probes fire at the exact points the original single-file renderer early-returned.
/// </summary>
public static class RenderPipeline
{
    public static void Run(GameAssetProvider assets, RenderOptions options, RenderProbes probes)
    {
        var scene = Collect(assets, options);
        if (scene == null)
        {
            return;
        }

        var (frame, maxSectionX, maxSectionY) = BuildFrame(scene, options);
        var state = new RenderState(frame);

        // The world-aligned macro pigment tints both the terrain and the placed rock, from the shared material.
        var pigment = new MacroPigment(scene.Tiles.Count > 0 ? scene.Tiles[0].Material : null, options.PigmentStrength);

        var layerAt = probes.LayerAt != null ? new LayerSampleProbe(probes.LayerAt, frame) : null;
        HeightmapDecoder.Decode(state, scene.Tiles, options, pigment, layerAt);

        if (probes.ZTestPath != null)
        {
            new ZLevelProbe(probes.ZTestPath).Report(state);
            return;
        }

        state.SnapshotSeabed();
        if (options.RenderRocks)
        {
            HigherGroundRasteriser.Rasterise(state, scene.Meshes, scene.FloraInstanceCount, scene.ExcludedRockCount, options, new MeshGeometryCache(), pigment, BuildRockProbe(probes, frame));
        }

        var traceIndex = -1;
        if (probes.WaterTrace is { } waterTrace)
        {
            int col = (int)Math.Round(frame.FractionalColumn(waterTrace.X)), row = (int)Math.Round(frame.FractionalRow(waterTrace.Y));
            if (col >= 0 && col < frame.Width && row >= 0 && row < frame.Height)
            {
                traceIndex = row * frame.Width + col;
                Console.WriteLine($"[water-trace] ({waterTrace.X:F0},{waterTrace.Y:F0}) -> cell ({col},{row})");
            }
        }

        WaterModelBuilder.FloodOceanVoid(state);
        WaterModelBuilder.RasteriseVolumes(state, scene.WaterVolumes, scene.WaterSeeds, options, traceIndex);
        WaterModelBuilder.ApplyBlueBoxes(state, options);
        if (options.RenderRivers && scene.Rivers.Count > 0)
        {
            WaterModelBuilder.StampRivers(state, scene.Rivers, options, traceIndex);
        }

        WaterModelBuilder.SpreadFlowingWater(state, options);
        WaterModelBuilder.FillShallowPonds(state, scene.WaterSeeds, options, traceIndex);
        WaterModelBuilder.FloodSubSeaConnected(state, options);

        if (probes.Cells != null)
        {
            new CellStatsProbe(probes.Cells).Report(state);
            return;
        }

        if (probes.PointXy != null)
        {
            new PointProbe(probes.PointXy).Report(state);
            return;
        }

        if (options.WetWater)
        {
            WaterModelBuilder.FloodWetSand(state, options, traceIndex);
        }

        WaterModelBuilder.SinkSubmergedObjects(state, options);

        var images = MapShader.Render(state, options);
        MapWriter.Write(state, images, options, maxSectionX, maxSectionY);
        Console.WriteLine("DONE");
    }

    private static SceneCollector? Collect(GameAssetProvider assets, RenderOptions options)
    {
        var cells = assets.GeneratedCellPackages();
        var collector = new SceneCollector(options);
        Console.WriteLine($"pass A: collecting LandscapeComponents from {cells.Count} cells...");
        var processed = 0;
        foreach (var cell in cells)
        {
            if (++processed % 1000 == 0)
            {
                Console.WriteLine($"  ...{processed}/{cells.Count} comps={collector.Tiles.Count}");
            }

            try
            {
                foreach (var export in assets.Provider.LoadPackage(cell).GetExports())
                {
                    collector.TryAddWaterSeed(export);
                    collector.TryAddMesh(export);
                    collector.TryAddRiver(export);
                    collector.TryAddTile(export);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[cell] {cell}: {ex.Message}");
            }
        }

        if (collector.Tiles.Count == 0)
        {
            Console.WriteLine("no components");
            return null;
        }

        Console.WriteLine("collecting water bodies from persistent level...");
        foreach (var package in assets.PersistentLevelPackages())
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(package).GetExports())
                {
                    collector.TryAddWaterSeed(export);
                    collector.TryAddWaterVolume(export);
                }
            }
            catch
            {
                // A level package that fails to load contributes no water — tolerated, as before.
            }
        }

        Console.WriteLine($"water seeds: {collector.WaterSeeds.Count}");
        Console.WriteLine($"placed meshes: {collector.Meshes.Count} (flora instances incl. FGFoliage: {collector.FloraInstanceCount}, excluded rocks: {collector.ExcludedRockCount})");
        return collector;
    }

    private static (WorldFrame Frame, int MaxSectionX, int MaxSectionY) BuildFrame(SceneCollector scene, RenderOptions options)
    {
        var downsample = options.Downsample;
        var minSectionX = scene.Tiles.Min(t => t.SectionX) - WorldFrame.PadQuads;
        var maxSectionX = scene.Tiles.Max(t => t.SectionX) + WorldFrame.PadQuads;
        var minSectionY = scene.Tiles.Min(t => t.SectionY) - WorldFrame.PadQuads;
        var maxSectionY = scene.Tiles.Max(t => t.SectionY) + WorldFrame.PadQuads;
        int quadsWide = maxSectionX - minSectionX + 128, quadsHigh = maxSectionY - minSectionY + 128;
        int width = (quadsWide + downsample - 1) / downsample, height = (quadsHigh + downsample - 1) / downsample;
        Console.WriteLine($"components={scene.Tiles.Count}  section X[{minSectionX}..{maxSectionX}] Y[{minSectionY}..{maxSectionY}]  grid {quadsWide}x{quadsHigh} -> out {width}x{height} (ds={downsample})");

        var frame = new WorldFrame(downsample, minSectionX, minSectionY, width, height, 100.0 + options.ZAdjust);
        return (frame, maxSectionX, maxSectionY);
    }

    private static RockFootprintProbe? BuildRockProbe(RenderProbes probes, WorldFrame frame)
    {
        if (probes.RockAt == null)
        {
            return null;
        }

        var targets = probes.RockAt
            .Select(r => new RockFootprintProbe.Target(
                (int)Math.Round(frame.FractionalColumn(r.X)),
                (int)Math.Round(frame.FractionalRow(r.Y)),
                r.Label))
            .ToList();
        return new RockFootprintProbe(targets, frame.Width);
    }
}
