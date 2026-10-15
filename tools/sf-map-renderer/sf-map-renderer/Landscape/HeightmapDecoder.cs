// Pass B of the render: decodes each landscape tile's height texture into the height grid, blends
// the weightmaps into terrain colour, records the wet-sand signal and nulls visibility holes to
// void.

using System.Globalization;

using SfMapRenderer.Collection;
using SfMapRenderer.Configuration;
using SfMapRenderer.Rendering;

namespace SfMapRenderer.Landscape;

/// <summary>
/// Pass B: decodes each landscape tile's height texture into the grid and weight-blends the material
/// weightmaps into terrain colour, recording the wet-sand signal and nulling landscape-visibility holes
/// to void. A weightmap failure loses colour only — never height.
/// </summary>
public static class HeightmapDecoder
{
    // PF_B8G8R8A8 on disk is {B,G,R,A}; a weightmap channel R,G,B,A maps to these byte offsets.
    private static readonly int[] ChannelByteOffset = [2, 1, 0, 3];

    // Baked grass density (0-255) at which the grass carpet fully covers the ground; grass overlays sand, so even
    // a moderate baked density reads as full cover from above. Below it, the overlay scales down.
    private const double GrassSaturation = 110.0;

    /// <param name="layerAt">Optional LAYERAT probe sink, driven per weightmap sample.</param>
    public static void Decode(
        RenderState state,
        IReadOnlyList<LandscapeTile> tiles,
        RenderOptions options,
        MacroPigment pigment,
        ILayerAtSink? layerAt = null)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height, downsample = frame.Downsample;
        int minSectionX = frame.MinSectionX, minSectionY = frame.MinSectionY;
        var heightGrid = state.Height;
        var terrain = state.Terrain;
        var wetWeight = state.WetWeight;

        Console.WriteLine("pass B: decode heightmap + weightmaps, splat...");
        layerAt?.PrintSetup();
        // Sample the real per-layer terrain colours from the shared material once (pigment is built in the pipeline).
        var layerColours = new TerrainLayerColours(tiles.Count > 0 ? tiles[0].Material : null);
        Console.WriteLine($"terrain: layer colours from material; macro pigment {(pigment.Available ? $"on (strength {options.PigmentStrength})" : "off")}");
        var processed = 0;
        int heightFailures = 0, weightFailures = 0;
        foreach (var tile in tiles)
        {
            if (++processed % 500 == 0)
            {
                Console.WriteLine($"  ...{processed}/{tiles.Count}");
            }

            int tileWidth, tileHeight;
            byte[] heightBytes;
            try
            {
                var mip = tile.Heightmap.GetFirstMip();
                var data = mip?.BulkData?.Data;
                if (mip == null || data == null || data.Length < mip.SizeX * mip.SizeY * 4)
                {
                    heightFailures++;
                    continue;
                }

                tileWidth = mip.SizeX;
                tileHeight = mip.SizeY;
                heightBytes = data;
            }
            catch (Exception ex)
            {
                heightFailures++;
                Console.Error.WriteLine($"[height] {ex.Message}");
                continue;
            }

            SplatHeight(tile, heightGrid, heightBytes, tileWidth, tileHeight, downsample, minSectionX, minSectionY, width, height);

            try
            {
                SplatTerrain(state, tile, options, terrain, wetWeight, heightGrid, tileWidth, tileHeight, downsample, minSectionX, minSectionY, width, height, layerAt, layerColours, pigment);
            }
            catch (Exception ex)
            {
                weightFailures++;
                Console.Error.WriteLine($"[weight] {ex.Message}");
            }
        }

        var voidCells = heightGrid.Count(v => v == 0);
        var voidPercent = (100.0 * voidCells / (width * height)).ToString("F1", CultureInfo.InvariantCulture);
        Console.WriteLine($"pass B done. height-fail={heightFailures} weight-fail={weightFailures}  void cells={voidCells}/{width * height} ({voidPercent}%)  visibility-holes nulled={state.VisibilityHoleCount}");
    }

    private static void SplatHeight(
        LandscapeTile tile, float[] heightGrid, byte[] heightBytes, int tileWidth, int tileHeight,
        int downsample, int minSectionX, int minSectionY, int width, int height)
    {
        for (var j = 0; j < tileHeight; j += downsample)
        {
            var row = (tile.SectionY - minSectionY + j) / downsample;
            if (row < 0 || row >= height)
            {
                continue;
            }

            for (var i = 0; i < tileWidth; i += downsample)
            {
                var column = (tile.SectionX - minSectionX + i) / downsample;
                if (column < 0 || column >= width)
                {
                    continue;
                }

                var p = (j * tileWidth + i) * 4;
                heightGrid[row * width + column] = (heightBytes[p + 2] << 8) | heightBytes[p + 1];
            }
        }
    }

    private static void SplatTerrain(
        RenderState state, LandscapeTile tile, RenderOptions options, byte[] terrain, byte[] wetWeight, float[] heightGrid,
        int tileWidth, int tileHeight, int downsample, int minSectionX, int minSectionY, int width, int height,
        ILayerAtSink? layerAt, TerrainLayerColours layerColours, MacroPigment pigment)
    {
        var weightData = tile.Weightmaps
            .Select(t =>
            {
                try
                {
                    var mip = t.GetFirstMip();
                    return (Data: mip?.BulkData?.Data, Width: mip?.SizeX ?? 0, Height: mip?.SizeY ?? 0);
                }
                catch
                {
                    return (Data: (byte[]?)null, Width: 0, Height: 0);
                }
            })
            .ToArray();

        for (var j = 0; j < tileHeight; j += downsample)
        {
            var row = (tile.SectionY - minSectionY + j) / downsample;
            if (row < 0 || row >= height)
            {
                continue;
            }

            for (var i = 0; i < tileWidth; i += downsample)
            {
                var column = (tile.SectionX - minSectionX + i) / downsample;
                if (column < 0 || column >= width)
                {
                    continue;
                }

                var p = (j * tileWidth + i) * 4;
                double sumR = 0, sumG = 0, sumB = 0, sumWeight = 0;
                foreach (var allocation in tile.Allocations)
                {
                    if (allocation.TextureIndex < 0 || allocation.TextureIndex >= weightData.Length)
                    {
                        continue;
                    }

                    var (data, dataWidth, dataHeight) = weightData[allocation.TextureIndex];
                    if (data == null || dataWidth != tileWidth || dataHeight != tileHeight)
                    {
                        continue;
                    }

                    var offset = p + ChannelByteOffset[Math.Clamp(allocation.Channel, 0, 3)];
                    if (offset >= data.Length)
                    {
                        continue;
                    }

                    double weight = data[offset];
                    if (weight <= 0)
                    {
                        continue;
                    }

                    layerAt?.Observe(column, row, allocation.Layer, (int)weight);

                    if (options.NullVisibilityHoles && allocation.Layer == "LandscapeVisibilityLayerInfo" && weight >= options.VisibilityThreshold)
                    {
                        heightGrid[row * width + column] = 0;
                        state.VisibilityHoleCount++;
                    }

                    if (allocation.Layer is "WetSand" or "Puddles")
                    {
                        var index = row * width + column;
                        if (weight > wetWeight[index])
                        {
                            wetWeight[index] = (byte)weight;
                        }
                    }

                    var (r, g, b) = layerColours.ColourFor(allocation.Layer);
                    sumR += weight * r;
                    sumG += weight * g;
                    sumB += weight * b;
                    sumWeight += weight;
                }

                if (sumWeight > 0)
                {
                    var cell = (row * width + column) * 3;
                    var blended = ((byte)(sumR / sumWeight), (byte)(sumG / sumWeight), (byte)(sumB / sumWeight));
                    // Overlay the world-aligned macro pigment (u,v across the landscape) for regional variation.
                    var (pr, pg, pb) = pigment.Apply(blended, (double)column / width, (double)row / height);

                    // Overlay the game's baked Landscape-Grass carpet (green/red per biome) where it grows.
                    if (tile.GrassOverlay is { } grass && tile.GrassStride > 0)
                    {
                        var g = (j * tile.GrassStride + i) * 4;
                        if (g + 3 < grass.Length && grass[g + 3] > 0)
                        {
                            var f = Math.Min(1.0, grass[g + 3] / GrassSaturation) * options.GrassStrength;
                            pr = (byte)(pr * (1 - f) + grass[g] * f);
                            pg = (byte)(pg * (1 - f) + grass[g + 1] * f);
                            pb = (byte)(pb * (1 - f) + grass[g + 2] * f);
                        }
                    }

                    terrain[cell] = pr;
                    terrain[cell + 1] = pg;
                    terrain[cell + 2] = pb;
                }
            }
        }
    }
}
