// Annotates a flat render with biome outlines, biome names and the 40x34 coordinate grid, writing a
// labelled PNG and an embed JPEG next to the source PPM.

using SfMapRenderer.Imaging;

using SixLabors.Fonts;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Drawing.Processing;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace SfMapRenderer.Artifacts;

/// <summary>
/// Annotates a flat render with biome outlines + names and a 40×34 coordinate grid, writing a labelled PNG
/// and an embed JPEG (the C# port of overlay.py; the map-artifact.html patch is dropped).
/// </summary>
public static class ReviewOverlayRenderer
{
    private const int Columns = MapAnnotations.Columns;
    private const int Rows = MapAnnotations.Rows;

    public static void Render(string ppmPath, string biomesPath)
    {
        var basePath = ppmPath[..ppmPath.LastIndexOf('.')];
        using var image = PpmReader.Load(ppmPath).CloneAs<Rgba32>();
        int width = image.Width, height = image.Height;
        var biomes = BiomeDataset.Load(biomesPath);
        var nameFont = EmbeddedFont.At(30);
        var areaFont = EmbeddedFont.At(23);
        var labelFont = EmbeddedFont.At(16);

        image.Mutate(ctx =>
        {
            foreach (var biome in biomes)
            {
                foreach (var polygon in biome.Polygons)
                {
                    var points = polygon.Select(p => MapAnnotations.Pixel(p.X, p.Y, 1.0)).ToArray();
                    MapAnnotations.DrawPolyline(ctx, Color.FromRgba(255, 240, 60, 200), 3f, [.. points, points[0]]);
                }

                var centre = MapAnnotations.BiomeLabelAnchor(biome, width, height, 1.0);
                var colour = MapAnnotations.ParseColour(biome.LabelColour, Color.Black);
                var halo = colour == Color.White ? Color.Black : Color.White;
                MapAnnotations.DrawCentredText(ctx, biome.DisplayLabel, nameFont, centre, colour, halo);
            }

            foreach (var area in biomes.SelectMany(b => b.SubLocations))
            {
                if (MapAnnotations.TryCellCentre(area.LabelCell, width, height, out var centre))
                {
                    MapAnnotations.DrawCentredText(ctx, area.Name, areaFont, centre, Color.Black, Color.White);
                }
            }

            double cellWidth = (double)width / Columns, cellHeight = (double)height / Rows;
            var gridColor = Color.FromRgba(0, 255, 255, 190);
            for (var c = 0; c <= Columns; c++)
            {
                MapAnnotations.DrawPolyline(ctx, gridColor, 2f, [new PointF((float)(c * cellWidth), 0), new PointF((float)(c * cellWidth), height)]);
            }

            for (var r = 0; r <= Rows; r++)
            {
                MapAnnotations.DrawPolyline(ctx, gridColor, 2f, [new PointF(0, (float)(r * cellHeight)), new PointF(width, (float)(r * cellHeight))]);
            }

            for (var c = 0; c < Columns; c++)
            {
                for (var r = 0; r < Rows; r++)
                {
                    ctx.DrawText($"{MapAnnotations.ColumnLabel(c)}{r + 1}", labelFont, Color.Black, new PointF((float)(c * cellWidth + 3), (float)(r * cellHeight + 2)));
                }
            }
        });

        image.SaveAsPng(basePath + "_labeled.png");
        using (var embed = image.CloneAs<Rgb24>())
        {
            embed.SaveAsJpeg(basePath + "_embed.jpg", new JpegEncoder { Quality = 80 });
        }

        Console.WriteLine($"overlay done: {basePath}_labeled.png");
    }
}
