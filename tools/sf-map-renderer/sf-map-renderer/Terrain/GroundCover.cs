// Accumulates dense ground-cover foliage (grass, ferns, small plants) as per-cell colour and blends
// it into the terrain so vegetated ground reads green from above.

using SfMapRenderer.Configuration;

namespace SfMapRenderer.Terrain;

/// <summary>
/// Accumulates dense ground-cover foliage (grass, ferns, small plants) as a per-cell colour, then blends it into
/// the terrain so vegetated ground reads as its canopy colour from above. Grass geometry is too thin to fill a
/// map cell if z-buffered as canopy, so instead each instance stamps its small footprint here; where many
/// overlap (real vegetated ground) the terrain goes fully green, where few do (a stray desert plant) it barely
/// shifts. See base-map-foliage-decode.md.
/// </summary>
public sealed class GroundCover
{
    // Overlap count at which the terrain is fully tinted; below it the tint scales down, so sparse foliage
    // (deserts) stays sandy while dense cover (Jungle Spires) greens completely.
    private const double Saturation = 3.0;

    // Each instance tints a small disc, not just its footprint cell — the game's grass carpet spreads between
    // plants, so a plant every few metres reads as continuous cover from above. (Cells; ds2 ≈ 2 m each.)
    private const int Radius = 2;

    // A single ground-cover instance should never span more than a few cells; clamp runaways.
    private const int MaxSpan = 6;

    private readonly int[] _count;
    private readonly int[] _sum;

    public GroundCover(int cellCount)
    {
        _count = new int[cellCount];
        _sum = new int[cellCount * 3];
    }

    /// <summary>Add one instance's footprint (the grid bbox of its projected vertices) to the accumulator.</summary>
    public void Stamp(double[] gridX, double[] gridY, WorldFrame frame, (byte R, byte G, byte B) tint)
    {
        double minX = double.MaxValue, maxX = double.MinValue, minY = double.MaxValue, maxY = double.MinValue;
        for (var i = 0; i < gridX.Length; i++)
        {
            if (gridX[i] < minX) minX = gridX[i];
            if (gridX[i] > maxX) maxX = gridX[i];
            if (gridY[i] < minY) minY = gridY[i];
            if (gridY[i] > maxY) maxY = gridY[i];
        }

        int cxi = (int)Math.Round((minX + maxX) / 2), cyi = (int)Math.Round((minY + maxY) / 2);
        int x0 = (int)Math.Floor(minX), x1 = (int)Math.Ceiling(maxX);
        int y0 = (int)Math.Floor(minY), y1 = (int)Math.Ceiling(maxY);
        if (x1 - x0 > MaxSpan || y1 - y0 > MaxSpan)
        {
            // An implausibly large footprint (bad transform) — fall back to the centre cell.
            x0 = x1 = cxi;
            y0 = y1 = cyi;
        }

        // Grow by the spread radius so a scattered plant reads as continuous ground cover, then clamp.
        x0 = Math.Max(0, x0 - Radius); x1 = Math.Min(frame.Width - 1, x1 + Radius);
        y0 = Math.Max(0, y0 - Radius); y1 = Math.Min(frame.Height - 1, y1 + Radius);
        if (x1 < x0 || y1 < y0)
        {
            return;
        }

        for (var y = y0; y <= y1; y++)
        {
            for (var x = x0; x <= x1; x++)
            {
                var cell = y * frame.Width + x;
                _count[cell]++;
                _sum[cell * 3] += tint.R;
                _sum[cell * 3 + 1] += tint.G;
                _sum[cell * 3 + 2] += tint.B;
            }
        }
    }

    /// <summary>
    /// Blend the accumulated foliage cover into the colour of a grass-carpeted rock/mesh top (objectKind 1 = rock) —
    /// grass grows on top of the spire meshes, so the mesh top must read as its cover, not bare rock. The landscape
    /// ground is left to the baked Landscape-Grass overlay (the authoritative per-vertex signal); tinting it here too
    /// would let a stray/dull foliage colour override the correct baked grass. Returns the number of cells tinted.
    /// </summary>
    public int Blend(byte[] objectColour, byte[] objectKind, double strength)
    {
        var tinted = 0;
        for (var cell = 0; cell < _count.Length; cell++)
        {
            var n = _count[cell];
            if (n == 0 || objectKind[cell] != 1)
            {
                continue;
            }

            var t = cell * 3;
            var factor = Math.Min(1.0, n / Saturation) * strength;
            objectColour[t] = Mix(objectColour[t], _sum[t] / n, factor);
            objectColour[t + 1] = Mix(objectColour[t + 1], _sum[t + 1] / n, factor);
            objectColour[t + 2] = Mix(objectColour[t + 2], _sum[t + 2] / n, factor);
            tinted++;
        }

        return tinted;
    }

    private static byte Mix(byte baseValue, int coverValue, double factor) =>
        (byte)Math.Clamp(baseValue * (1 - factor) + coverValue * factor, 0, 255);
}
