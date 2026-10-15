// Standalone survey: dumps the transform, parent chain and local bounds of placed meshes matching a
// path substring near a coordinate, for debugging flora sizing.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Dumps the full transform + parent chain + mesh local bounds for placed meshes whose path contains a
/// substring, near a coordinate — used to debug flora sizing (was MODE=meshinspect).
/// </summary>
public static class MeshInspectProbe
{
    public static void Report(GameAssetProvider assets, double targetX, double targetY, string substring, double radius)
    {
        var found = 0;
        foreach (var cell in assets.GeneratedCellPackages())
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(cell).GetExports())
                {
                    if (!export.ExportType.Contains("StaticMeshComponent", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var meshIndex = export.MeshIndex();
                    var path = meshIndex?.ResolvedObject?.GetPathName();
                    if (path == null || !path.Contains(substring, StringComparison.Ordinal) || !export.HasRelativeLocation())
                    {
                        continue;
                    }

                    var location = export.RelativeLocation();
                    if (Math.Sqrt((location.X - targetX) * (location.X - targetX) + (location.Y - targetY) * (location.Y - targetY)) > radius)
                    {
                        continue;
                    }

                    var scale = export.RelativeScale();
                    var rotation = export.RelativeRotation();
                    Console.WriteLine($"\n{path[(path.LastIndexOf('/') + 1)..]} [{export.ExportType}]");
                    Console.WriteLine($"  RelativeLocation=({location.X:F0},{location.Y:F0},{location.Z:F0}) RelativeScale3D=({scale.X:F2},{scale.Y:F2},{scale.Z:F2}) rot=({rotation.Pitch:F0},{rotation.Yaw:F0},{rotation.Roll:F0})");

                    var parent = export.GetOrDefault<UObject?>("AttachParent");
                    var depth = 0;
                    while (parent != null && depth++ < 6)
                    {
                        var parentLocation = parent.RelativeLocation();
                        var parentScale = parent.RelativeScale();
                        Console.WriteLine($"  ^ parent [{parent.ExportType}] '{parent.Name}' loc=({parentLocation.X:F0},{parentLocation.Y:F0},{parentLocation.Z:F0}) scale=({parentScale.X:F2},{parentScale.Y:F2},{parentScale.Z:F2})");
                        parent = parent.GetOrDefault<UObject?>("AttachParent");
                    }

                    if (meshIndex?.ResolvedObject?.Load() is UStaticMesh staticMesh
                        && staticMesh.RenderData?.LODs is { Length: > 0 } lods
                        && lods[0].PositionVertexBuffer?.Verts is { Length: > 0 } vertices)
                    {
                        double minX = 1e18, maxX = -1e18, minY = 1e18, maxY = -1e18, minZ = 1e18, maxZ = -1e18;
                        foreach (var v in vertices)
                        {
                            minX = Math.Min(minX, v.X);
                            maxX = Math.Max(maxX, v.X);
                            minY = Math.Min(minY, v.Y);
                            maxY = Math.Max(maxY, v.Y);
                            minZ = Math.Min(minZ, v.Z);
                            maxZ = Math.Max(maxZ, v.Z);
                        }

                        Console.WriteLine($"  mesh local bounds: X[{minX:F0},{maxX:F0}] Y[{minY:F0},{maxY:F0}] Z[{minZ:F0},{maxZ:F0}]  -> XY extent {(maxX - minX) / 100:F1}m x {(maxY - minY) / 100:F1}m; scaled x{scale.X:F1} = {(maxX - minX) / 100 * scale.X:F1}m x {(maxY - minY) / 100 * scale.Y:F1}m");
                    }

                    if (++found >= 6)
                    {
                        Console.WriteLine("\n(stopping at 6)");
                        Console.WriteLine("DONE");
                        return;
                    }
                }
            }
            catch
            {
                // Skip a cell that fails to load, as before.
            }
        }

        Console.WriteLine($"\n{found} matched");
        Console.WriteLine("DONE");
    }
}
