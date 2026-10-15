// The LAYERAT probe: records and prints the material layers and weights at chosen cells during the
// landscape decode, to confirm what a cell is painted with.

using SfMapRenderer.Configuration;
using SfMapRenderer.Landscape;

namespace SfMapRenderer.Diagnostics;

/// <summary>
/// The LAYERAT probe: dumps the material layers + weights at chosen cells during pass B, to confirm what a
/// cell is painted with (it identified the visibility holes). Runs as part of a normal render.
/// </summary>
public sealed class LayerSampleProbe : ILayerAtSink
{
    private readonly List<(int Column, int Row, double WorldX, double WorldY)> _points;
    private readonly Dictionary<(int Column, int Row), string> _labels = [];

    public LayerSampleProbe(IReadOnlyList<(double X, double Y)> coordinates, WorldFrame frame)
    {
        _points = coordinates
            .Select(c => ((int)Math.Round(frame.FractionalColumn(c.X)), (int)Math.Round(frame.FractionalRow(c.Y)), c.X, c.Y))
            .ToList();
        foreach (var point in _points)
        {
            _labels[(point.Item1, point.Item2)] = $"{point.Item3},{point.Item4}";
        }
    }

    public void PrintSetup()
    {
        foreach (var (column, row, worldX, worldY) in _points)
        {
            Console.WriteLine($"LAYERAT probe cell ox={column} oy={row} (world {worldX},{worldY})");
        }
    }

    public void Observe(int column, int row, string layer, int weight)
    {
        if (_labels.TryGetValue((column, row), out var label))
        {
            Console.WriteLine($"  LAYERAT[{label}] {layer,-14} weight={weight,3}");
        }
    }
}
