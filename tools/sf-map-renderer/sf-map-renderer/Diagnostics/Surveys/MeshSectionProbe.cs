// Standalone survey: dumps a mesh's material sections (slot, triangle count, Z range) for named
// tree families, showing how trunk and foliage split.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Dumps a mesh's material sections (slot/material + triangle count + Z-range) for the named tree families,
/// showing how trunk and foliage sections split (was MODE=meshsections).
/// </summary>
public static class MeshSectionProbe
{
    private static readonly string[] DefaultFamilies = ["TitanTree", "Kapok", "GreenTree", "DioTree", "BluePalm"];

    public static void Report(GameAssetProvider assets, IReadOnlyList<string>? families = null)
    {
        var want = families ?? DefaultFamilies;
        var seen = new HashSet<string>();
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
                    if (path == null || !want.Any(w => path.Contains(w, StringComparison.Ordinal)))
                    {
                        continue;
                    }

                    var name = path[(path.LastIndexOf('/') + 1)..].Split('.')[0];
                    if (!seen.Add(name))
                    {
                        continue;
                    }

                    if (meshIndex!.ResolvedObject?.Load() is not UStaticMesh staticMesh || staticMesh.RenderData?.LODs is not { Length: > 0 } lods)
                    {
                        continue;
                    }

                    var lod = lods[0];
                    var vertices = lod.PositionVertexBuffer?.Verts;
                    var indexBuffer = lod.IndexBuffer;
                    var materials = staticMesh.StaticMaterials;
                    Console.WriteLine($"\n{name}  ({lod.Sections?.Length ?? 0} sections, {materials?.Length ?? 0} materials)");
                    if (lod.Sections != null)
                    {
                        foreach (var section in lod.Sections)
                        {
                            var material = materials != null && section.MaterialIndex < materials.Length ? materials[section.MaterialIndex] : null;
                            var slotName = material?.MaterialSlotName.Text ?? "?";
                            var materialPath = material?.MaterialInterface?.GetPathName() ?? "?";
                            var materialName = materialPath.Contains('/') ? materialPath[(materialPath.LastIndexOf('/') + 1)..].Split('.')[0] : materialPath;
                            double minZ = 1e18, maxZ = -1e18;
                            if (vertices != null && indexBuffer != null)
                            {
                                for (int i = (int)section.FirstIndex; i < (int)(section.FirstIndex + section.NumTriangles * 3) && i < indexBuffer.Length; i++)
                                {
                                    var vi = (int)indexBuffer[i];
                                    if (vi < vertices.Length)
                                    {
                                        minZ = Math.Min(minZ, vertices[vi].Z);
                                        maxZ = Math.Max(maxZ, vertices[vi].Z);
                                    }
                                }
                            }

                            Console.WriteLine($"    slot='{slotName}' mat={materialName} tris={section.NumTriangles} Z[{minZ / 100:F1}..{maxZ / 100:F1}]m");
                        }
                    }

                    if (seen.Count >= want.Count)
                    {
                        Console.WriteLine("\nDONE");
                        return;
                    }
                }
            }
            catch
            {
                // Skip a cell that fails to load, as before.
            }
        }

        Console.WriteLine("\nDONE");
    }
}
