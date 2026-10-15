// Shared helpers for the review overlay and the layered artifact: world-to-pixel mapping, the
// A1..AN34 grid labels and cell centres, biome label anchors, and centred or haloed text and
// polyline drawing.

using SixLabors.Fonts;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Drawing;
using SixLabors.ImageSharp.Drawing.Processing;
using SixLabors.ImageSharp.Processing;

namespace SfMapRenderer.Artifacts;

/// <summary>Shared world→pixel mapping and label helpers for the review overlay and the layered artifact.</summary>
public static class MapAnnotations
{
    /// <summary>The coordinate-grid dimensions used by every overlay: A1 … AN34.</summary>
    public const int Columns = 40;
    public const int Rows = 34;

    // The standard DS=2 render frame the Python companions assumed: origin −50800, 1 quad = 100 cm,
    // section min −2900, downsample 2. `scale` is the target-vs-full-res factor (1 for the full-res overlay).
    public static PointF Pixel(double worldX, double worldY, double scale)
    {
        var x = ((worldX + 50800) / 100 + 2900) / 2 * scale;
        var y = ((worldY + 50800) / 100 + 2900) / 2 * scale;
        return new PointF((float)x, (float)y);
    }

    /// <summary>0→A … 25→Z, 26→AA … 39→AN.</summary>
    public static string ColumnLabel(int column) =>
        column < 26 ? ((char)('A' + column)).ToString() : "A" + (char)('A' + column - 26);

    /// <summary>Fraction a within-cell position keyword shifts the anchor from the cell centre toward an edge.</summary>
    private const double EdgeNudge = 0.35;

    /// <summary>
    /// Parses an A1..AN34 grid reference to the pixel anchor for a label in an
    /// <paramref name="width"/>×<paramref name="height"/> image. The reference is a cell token (e.g. <c>"J4"</c>,
    /// <c>"AB27"</c>) optionally followed by within-cell position keywords — <c>left</c>/<c>right</c>/<c>top</c>
    /// (=<c>up</c>)/<c>bottom</c> (=<c>down</c>), combinable for corners (e.g. <c>"S6 bottom right"</c>,
    /// parentheses ignored) — which nudge the anchor away from the cell centre. Each keyword shifts by
    /// <see cref="EdgeNudge"/> of a cell unless followed by an explicit magnitude (<c>half</c>, <c>quarter</c>, or
    /// a decimal like <c>0.5</c>), and shifts accumulate — so <c>"N14 down 0.6 right 0.25"</c> and
    /// <c>"F14 down half"</c> move by fractions of a cell (values may exceed the cell). Returns false for a
    /// missing/out-of-range cell.
    /// </summary>
    public static bool TryCellCentre(string? cell, double width, double height, out PointF centre)
    {
        centre = default;
        if (string.IsNullOrWhiteSpace(cell))
        {
            return false;
        }

        var tokens = cell.Replace('(', ' ').Replace(')', ' ').ToUpperInvariant()
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (tokens.Length == 0)
        {
            return false;
        }

        var head = tokens[0];
        var split = 0;
        while (split < head.Length && head[split] is >= 'A' and <= 'Z')
        {
            split++;
        }

        if (split is 0 or > 2 || split == head.Length || !int.TryParse(head[split..], out var row))
        {
            return false;
        }

        // Column letters: "A".."Z" → 0..25, "AA".."AN" → 26..39 (single 'A' prefix, matching ColumnLabel).
        var column = split == 1 ? head[0] - 'A' : 26 + (head[1] - 'A');
        row -= 1;
        if (column < 0 || column >= Columns || row < 0 || row >= Rows)
        {
            return false;
        }

        // Optional within-cell position keywords accumulate a fractional shift from the cell centre; a direction
        // may be followed by an explicit magnitude, else it uses EdgeNudge. Unknown tokens are ignored.
        double fx = 0.5, fy = 0.5;
        for (var i = 1; i < tokens.Length; i++)
        {
            var (dx, dy) = tokens[i] switch
            {
                "LEFT" => (-1.0, 0.0),
                "RIGHT" => (1.0, 0.0),
                "TOP" or "UP" => (0.0, -1.0),
                "BOTTOM" or "DOWN" => (0.0, 1.0),
                _ => (0.0, 0.0),
            };
            if (dx == 0.0 && dy == 0.0)
            {
                continue;
            }

            var magnitude = EdgeNudge;
            if (i + 1 < tokens.Length && TryMagnitude(tokens[i + 1], out var explicitMagnitude))
            {
                magnitude = explicitMagnitude;
                i++;
            }

            fx += dx * magnitude;
            fy += dy * magnitude;
        }

        centre = new PointF((float)((column + fx) * width / Columns), (float)((row + fy) * height / Rows));
        return true;
    }

    /// <summary>Parses a within-cell shift magnitude: <c>half</c>=0.5, <c>quarter</c>=0.25, or a decimal fraction.</summary>
    private static bool TryMagnitude(string token, out double value)
    {
        switch (token)
        {
            case "HALF": value = 0.5; return true;
            case "QUARTER": value = 0.25; return true;
            default:
                return double.TryParse(token, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out value);
        }
    }

    /// <summary>
    /// The pixel anchor for a biome's name in an <paramref name="width"/>×<paramref name="height"/> image: the
    /// centre of its <see cref="Biome.LabelCell"/> grid cell when set, else the mean of its polygon vertices
    /// (mapped through <see cref="Pixel"/> at <paramref name="scale"/>). The centroid fallback is the legacy
    /// behaviour — a curated <c>labelCell</c> places the label precisely.
    /// </summary>
    public static PointF BiomeLabelAnchor(Biome biome, double width, double height, double scale)
    {
        if (TryCellCentre(biome.LabelCell, width, height, out var centre))
        {
            return centre;
        }

        var all = biome.Polygons.SelectMany(poly => poly.Select(p => Pixel(p.X, p.Y, scale))).ToList();
        return new PointF(all.Average(p => p.X), all.Average(p => p.Y));
    }

    /// <summary>
    /// Draws <paramref name="text"/> in black, centred both horizontally and vertically over
    /// <paramref name="centre"/>. Honours embedded line breaks (a <c>\r\n</c>/<c>\n</c> starts a new line), with
    /// each line centred within the block — so a caller supplies just the label's centre point.
    /// </summary>
    public static void DrawCentredText(IImageProcessingContext ctx, string text, Font font, PointF centre) =>
        DrawCentredText(ctx, text, font, centre, Color.Black, null);

    /// <inheritdoc cref="DrawCentredText(IImageProcessingContext, string, Font, PointF)"/>
    /// <remarks>
    /// Draws in <paramref name="colour"/> (e.g. white for a label over the black void). When <paramref name="halo"/>
    /// is set, the text is first stamped at eight surrounding offsets in that colour — a readability outline
    /// (white behind dark labels).
    /// </remarks>
    public static void DrawCentredText(IImageProcessingContext ctx, string text, Font font, PointF centre, Color colour, Color? halo)
    {
        var normalised = text.Replace("\r\n", "\n");
        if (halo is { } haloColour)
        {
            var r = Math.Max(1f, font.Size / 12f);
            foreach (var (ox, oy) in new (float, float)[] { (-r, 0), (r, 0), (0, -r), (0, r), (-r, -r), (r, -r), (-r, r), (r, r) })
            {
                ctx.DrawText(CentredOptions(font, centre.X + ox, centre.Y + oy), normalised, haloColour);
            }
        }

        ctx.DrawText(CentredOptions(font, centre.X, centre.Y), normalised, colour);
    }

    private static RichTextOptions CentredOptions(Font font, float x, float y) => new(font)
    {
        Origin = new System.Numerics.Vector2(x, y),
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        TextAlignment = TextAlignment.Center,
    };

    /// <summary>
    /// Parses a colour spec — a <c>#rrggbb</c>/<c>#rrggbbaa</c> hex string or the names <c>white</c>/<c>black</c> —
    /// returning <paramref name="fallback"/> for null/blank/unrecognised input. Used for per-label overrides.
    /// </summary>
    public static Color ParseColour(string? spec, Color fallback)
    {
        if (string.IsNullOrWhiteSpace(spec))
        {
            return fallback;
        }

        if (Color.TryParseHex(spec, out var hex))
        {
            return hex;
        }

        return spec.Trim().ToLowerInvariant() switch
        {
            "white" => Color.White,
            "black" => Color.Black,
            _ => fallback,
        };
    }

    /// <summary>Draws connected line segments (the DrawLines convenience isn't in ImageSharp.Drawing 1.0).</summary>
    public static void DrawPolyline(IImageProcessingContext ctx, Color color, float thickness, PointF[] points)
    {
        var path = new PathBuilder().AddLines(points).Build();
        ctx.Draw(color, thickness, path);
    }
}
