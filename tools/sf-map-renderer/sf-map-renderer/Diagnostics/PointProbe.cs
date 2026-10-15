// The PROBEXY probe: for each world coordinate, reports the seabed and rock heights, the water
// classification and the predicted render, to settle land, water or void disputes.

using System.Globalization;

using SfMapRenderer.Rendering;

namespace SfMapRenderer.Diagnostics;

/// <summary>
/// The PROBEXY probe: for each world coordinate, reports the seabed/rock heights, water classification and
/// the render prediction — the first-reach diagnostic for a land/water/void dispute.
/// </summary>
public sealed class PointProbe
{
    private readonly IReadOnlyList<(double X, double Y)> _coordinates;

    public PointProbe(IReadOnlyList<(double X, double Y)> coordinates)
    {
        _coordinates = coordinates;
    }

    public void Report(RenderState state)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        foreach (var (wx, wy) in _coordinates)
        {
            var column = (int)Math.Round(frame.FractionalColumn(wx));
            var row = (int)Math.Round(frame.FractionalRow(wy));
            if (column < 0 || column >= width || row < 0 || row >= height)
            {
                Console.WriteLine($"({wx:F0},{wy:F0}) OUT OF GRID");
                continue;
            }

            var idx = row * width + column;
            var raisedHeight = state.Height[idx];
            var seabed = state.BaseHeight[idx];
            var rockTopZ = raisedHeight == 0 ? double.NaN : frame.HeightToZ(raisedHeight);
            var seabedZ = seabed == 0 ? double.NaN : frame.HeightToZ(seabed);
            var render = state.IsOcean[idx] && !state.IsRock[idx] ? "OCEAN"
                : raisedHeight != 0 ? "land/rock"
                : state.VolumeVoid[idx] ? "OCEAN(void)"
                : "VOID(grey)";
            Console.WriteLine($"({wx:F0},{wy:F0}) col={column} row={row} h16={state.Height[idx]:F0} baseH16={seabed:F0} rockTopZ={rockTopZ:F0} seabedZ={seabedZ:F0} isRock={state.IsRock[idx]}  isOcean={state.IsOcean[idx]} isLake={state.IsLake[idx]} isRiver={state.IsRiver[idx]}  oceanVoid={state.OceanVoid[idx]} volVoid={state.VolumeVoid[idx]}  render={render}");

            // Replicate the MapShader water branch so we can see why a flowing/downhill cell reads dark.
            if (state.IsOcean[idx] || state.IsLake[idx])
            {
                var waterSurface = state.WaterZ[idx] != 0 ? state.WaterZ[idx] : -1730.0;
                var floorZ = seabed == 0 ? waterSurface - 8000 : frame.HeightToZ(state.Height[idx]);
                if (state.IsRiver[idx])
                {
                    floorZ = waterSurface - 200;
                }

                var depth = Math.Clamp(Math.Sqrt(Math.Max(0, waterSurface - floorZ) / 4000.0), 0, 1);
                var oceanBand = waterSurface is >= -1850 and <= -1600;
                Console.WriteLine($"      WATER waterZ(surf)={waterSurface:F0} floorZ={floorZ:F0} depthCm={waterSurface - floorZ:F0} depth={depth:F2} band={(oceanBand ? "ocean" : "inland")}");
            }
        }

        Console.WriteLine("DONE");
    }
}
