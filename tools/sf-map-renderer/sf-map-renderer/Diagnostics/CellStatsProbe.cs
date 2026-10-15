// The CELLS probe: reports land, sea, lake and void percentages for named cells of the coarse 20x17
// lettered grid, once the render state has the water classified.

using System.Globalization;

using SfMapRenderer.Rendering;

namespace SfMapRenderer.Diagnostics;

/// <summary>
/// The CELLS probe: reports the land/sea/lake/void percentages of named cells on a 20×17 lettered grid
/// (A–T columns, rows 1–17). Note this is the older coarse grid, not the 40×34 overlay grid.
/// </summary>
public sealed class CellStatsProbe
{
    private readonly IReadOnlyList<string> _cellNames;

    public CellStatsProbe(IReadOnlyList<string> cellNames)
    {
        _cellNames = cellNames;
    }

    public void Report(RenderState state)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var heightGrid = state.Height;
        var isOcean = state.IsOcean;
        var isLake = state.IsLake;
        double cellWidth = width / 20.0, cellHeight = height / 17.0;

        foreach (var name in _cellNames)
        {
            var trimmed = name.Trim();
            var column = char.ToUpperInvariant(trimmed[0]) - 'A';
            var row = int.Parse(trimmed[1..], CultureInfo.InvariantCulture) - 1;
            int x0 = (int)(column * cellWidth), x1 = (int)((column + 1) * cellWidth);
            int y0 = (int)(row * cellHeight), y1 = (int)((row + 1) * cellHeight);

            long water = 0, land = 0, voidCells = 0, lake = 0, total = 0;
            for (var y = y0; y < y1; y++)
            {
                for (var x = x0; x < x1; x++)
                {
                    var idx = y * width + x;
                    total++;
                    if (heightGrid[idx] == 0)
                    {
                        voidCells++;
                    }
                    else if (isLake[idx])
                    {
                        lake++;
                    }
                    else if (isOcean[idx])
                    {
                        water++;
                    }
                    else
                    {
                        land++;
                    }
                }
            }

            Console.WriteLine($"{trimmed,-4} land={100.0 * land / total,4:F0}%  sea={100.0 * water / total,4:F0}%  lake={100.0 * lake / total,3:F0}%  void={100.0 * voidCells / total,4:F0}%");
        }

        Console.WriteLine("DONE");
    }
}
