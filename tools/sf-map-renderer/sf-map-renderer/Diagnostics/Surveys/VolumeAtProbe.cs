// Standalone survey: reports which FGWaterVolume covers each coordinate and its authored surface Z.

using SfMapRenderer.Assets;
using SfMapRenderer.Geometry;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Reports which FGWaterVolume covers each coordinate and its authored surface Z — the tool that proved the
/// ocean-vs-void classifier (was MODE=volat).
/// </summary>
public static class VolumeAtProbe
{
    public static void Report(GameAssetProvider assets, IReadOnlyList<(double X, double Y)> coordinates)
    {
        var lines = new List<string>();
        foreach (var package in assets.AllGameLevelPackages())
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(package).GetExports())
                {
                    if (export.ExportType != "FGWaterVolume")
                    {
                        continue;
                    }

                    var root = export.GetOrDefault<UObject?>("RootComponent");
                    if (root?.GetOrDefault<UObject?>("Brush") is not UModel brush
                        || brush.Points is not { Length: > 0 } points
                        || brush.Nodes is not { Length: > 0 } nodes
                        || brush.Verts is not { Length: > 0 } verts)
                    {
                        continue;
                    }

                    var location = root.RelativeLocation();
                    var scale = root.RelativeScale();
                    var yaw = root.RelativeYawRadians();
                    double cos = Math.Cos(yaw), sin = Math.Sin(yaw);
                    double maxZ = -1e18, minZ = 1e18;
                    foreach (var p in points)
                    {
                        var z = location.Z + p.Z * scale.Z;
                        maxZ = Math.Max(maxZ, z);
                        minZ = Math.Min(minZ, z);
                    }

                    (double X, double Y) ToWorld(FVector p)
                    {
                        double sx = p.X * scale.X, sy = p.Y * scale.Y;
                        return (location.X + sx * cos - sy * sin, location.Y + sx * sin + sy * cos);
                    }

                    var faces = new List<(double X, double Y)[]>();
                    foreach (var node in nodes)
                    {
                        int vertexCount = node.NumVertices;
                        if (vertexCount < 3)
                        {
                            continue;
                        }

                        var polygon = new (double X, double Y)[vertexCount];
                        var valid = true;
                        for (var k = 0; k < vertexCount; k++)
                        {
                            var vertIndex = node.iVertPool + k;
                            if (vertIndex < 0 || vertIndex >= verts.Length)
                            {
                                valid = false;
                                break;
                            }

                            var pointIndex = verts[vertIndex].pVertex;
                            if (pointIndex < 0 || pointIndex >= points.Length)
                            {
                                valid = false;
                                break;
                            }

                            polygon[k] = ToWorld(points[pointIndex]);
                        }

                        if (valid)
                        {
                            faces.Add(polygon);
                        }
                    }

                    for (var q = 0; q < coordinates.Count; q++)
                    {
                        if (faces.Any(polygon => Polygons.Contains(polygon, coordinates[q].X, coordinates[q].Y)))
                        {
                            lines.Add($"pt{q} ({coordinates[q].X:F0},{coordinates[q].Y:F0}) IN {export.Name}  surfZ(max)={maxZ:F0}  minZ={minZ:F0}  loc.Z={location.Z:F0}  scl.Z={scale.Z:F2}");
                        }
                    }
                }
            }
            catch
            {
                // Skip a package that fails to load, as before.
            }
        }

        foreach (var line in lines.OrderBy(x => x))
        {
            Console.WriteLine("  " + line);
        }

        Console.WriteLine("DONE");
    }
}
