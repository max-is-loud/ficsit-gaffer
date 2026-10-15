// The ztest probe: compares the decoded terrain Z at each known collectible with its real Z and
// reports the mean offset, as a sanity check on the height decode.

using System.Text.Json;

using SfMapRenderer.Rendering;

namespace SfMapRenderer.Diagnostics;

/// <summary>
/// The ztest probe: compares the decoded terrain Z at each known collectible's XY against its real Z
/// (ground truth), reporting the mean offset — a sanity check on the height decode. Runs on the bare
/// landscape (before the rock pass), matching where it sat in the original pipeline.
/// </summary>
public sealed class ZLevelProbe
{
    private readonly string _worldLocationsPath;

    public ZLevelProbe(string worldLocationsPath)
    {
        _worldLocationsPath = worldLocationsPath;
    }

    public void Report(RenderState state)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var heightGrid = state.Height;

        using var document = JsonDocument.Parse(File.ReadAllText(_worldLocationsPath));
        var collectibles = document.RootElement.GetProperty("collectibles");

        var shown = 0;
        double sumDifference = 0;
        var count = 0;
        foreach (var collectible in collectibles.EnumerateArray())
        {
            double x = collectible.GetProperty("x").GetDouble();
            double y = collectible.GetProperty("y").GetDouble();
            double z = collectible.GetProperty("z").GetDouble();
            var column = (int)Math.Round(frame.FractionalColumn(x));
            var row = (int)Math.Round(frame.FractionalRow(y));
            if (column < 0 || column >= width || row < 0 || row >= height)
            {
                continue;
            }

            var h = heightGrid[row * width + column];
            if (h == 0)
            {
                continue;
            }

            var myZ = frame.HeightToZ(h);
            var difference = myZ - z;
            sumDifference += difference;
            count++;
            if (shown++ < 25)
            {
                Console.WriteLine($"  ({x,8:F0},{y,8:F0})  realZ={z,8:F0}  myZ={myZ,8:F0}  diff={difference,7:F0}");
            }
        }

        Console.WriteLine($"\nmean(myZ - realZ) = {sumDifference / Math.Max(1, count):F0} cm over {count} collectibles");
        Console.WriteLine("DONE");
    }
}
