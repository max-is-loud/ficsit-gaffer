// The optional diagnostic probe requests that ride on a render, held as raw world coordinates until
// the pipeline has a grid frame to map them onto.

namespace SfMapRenderer.Pipeline;

/// <summary>
/// Optional diagnostic overlays that ride on a render, supplied as raw world coordinates because their cell
/// mapping needs the grid frame (only known once pass A has run). The pipeline builds the actual probe
/// objects and fires them at the points where the original early-returned.
/// </summary>
public sealed class RenderProbes
{
    /// <summary>PROBEXY: per-coordinate land/water/void report (returns after the pond fill).</summary>
    public IReadOnlyList<(double X, double Y)>? PointXy { get; init; }

    /// <summary>ROCKAT: which instances rasterise onto each (world X, world Y, label) cell.</summary>
    public IReadOnlyList<(double X, double Y, string Label)>? RockAt { get; init; }

    /// <summary>CELLS: land/sea/lake/void percentages of named cells (returns after the pond fill).</summary>
    public IReadOnlyList<string>? Cells { get; init; }

    /// <summary>LAYERAT: material-layer dump at coordinates during pass B.</summary>
    public IReadOnlyList<(double X, double Y)>? LayerAt { get; init; }

    /// <summary>ztest: when set, compare decoded Z against the collectibles at this path (returns after pass B).</summary>
    public string? ZTestPath { get; init; }

    /// <summary>water-trace: log every water pass that writes this cell's surface, and each volume covering it.</summary>
    public (double X, double Y)? WaterTrace { get; init; }
}
