// Even-odd point-in-polygon test on world-XY polygons, used by the water-volume rasterise and the
// probes.

namespace SfMapRenderer.Geometry;

/// <summary>World-XY polygon tests.</summary>
public static class Polygons
{
    /// <summary>
    /// Ray-cast point-in-polygon test (world XY). Matches the classic even-odd rule used throughout the
    /// water-volume rasterise and the diagnostic probes.
    /// </summary>
    public static bool Contains((double X, double Y)[] polygon, double pointX, double pointY)
    {
        var inside = false;
        for (int i = 0, j = polygon.Length - 1; i < polygon.Length; j = i++)
        {
            if ((polygon[i].Y > pointY) != (polygon[j].Y > pointY)
                && pointX < (polygon[j].X - polygon[i].X) * (pointY - polygon[i].Y) / (polygon[j].Y - polygon[i].Y) + polygon[i].X)
            {
                inside = !inside;
            }
        }

        return inside;
    }
}
