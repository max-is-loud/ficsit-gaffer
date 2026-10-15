// Standalone survey: reports the world-XY footprints of the open-ocean water-plane meshes.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>Reports the open-ocean SM_GEN_WaterPlane meshes' world-XY footprints (was MODE=oceanmesh).</summary>
public static class OceanMeshProbe
{
    public static void Report(GameAssetProvider assets)
    {
        var packages = assets.AllGameLevelPackages();
        var processed = 0;
        foreach (var package in packages)
        {
            if (++processed % 3000 == 0)
            {
                Console.WriteLine($"  ...{processed}/{packages.Count}");
            }

            try
            {
                foreach (var export in assets.Provider.LoadPackage(package).GetExports())
                {
                    var meshIndex = export.MeshIndex();
                    var path = meshIndex?.ResolvedObject?.GetPathName() ?? "";
                    if (!path.Contains("WaterPlane", StringComparison.Ordinal) && !export.ExportType.Contains("WaterPlane", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    if (meshIndex?.ResolvedObject?.Load() is not UStaticMesh staticMesh || staticMesh.RenderData?.LODs is not { Length: > 0 } lods)
                    {
                        continue;
                    }

                    var location = export.RelativeLocation();
                    var scale = export.RelativeScale();
                    var yaw = export.RelativeYawRadians();
                    double cos = Math.Cos(yaw), sin = Math.Sin(yaw);
                    var lod = lods.OrderBy(l => l.PositionVertexBuffer?.Verts?.Length ?? int.MaxValue).First();
                    var vertices = lod.PositionVertexBuffer?.Verts;
                    if (vertices == null)
                    {
                        continue;
                    }

                    double minX = 1e18, maxX = -1e18, minY = 1e18, maxY = -1e18;
                    foreach (var v in vertices)
                    {
                        double wx = location.X + v.X * scale.X * cos - v.Y * scale.Y * sin, wy = location.Y + v.X * scale.X * sin + v.Y * scale.Y * cos;
                        minX = Math.Min(minX, wx);
                        maxX = Math.Max(maxX, wx);
                        minY = Math.Min(minY, wy);
                        maxY = Math.Max(maxY, wy);
                    }

                    Console.WriteLine($"[{export.ExportType}] {export.Name} mesh={path[(path.LastIndexOf('.') + 1)..]} loc=({location.X:F0},{location.Y:F0},{location.Z:F0}) scl=({scale.X:F2},{scale.Y:F2}) verts={vertices.Length} tris={(lod.IndexBuffer?.Length ?? 0) / 3}");
                    Console.WriteLine($"     worldXY bounds X[{minX:F0},{maxX:F0}] Y[{minY:F0},{maxY:F0}]  span {(maxX - minX) / 100:F0}m x {(maxY - minY) / 100:F0}m");
                }
            }
            catch
            {
                // Skip a package that fails to load, as before.
            }
        }

        Console.WriteLine("\nDONE");
    }
}
