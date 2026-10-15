// Loads and caches the LOD0 geometry of static meshes by asset path, classifying each triangle as
// foliage or trunk and attaching a sampled base colour per material section.

using CUE4Parse.UE4.Assets.Exports.Material;

using SfMapRenderer.Flora;

namespace SfMapRenderer.Meshes;

/// <summary>
/// LOD0 geometry for a placed mesh: vertices, triangle indices, a per-triangle foliage flag, and a per-triangle
/// base colour sampled from the section's material texture (0,0,0 = not sampled → caller uses its palette).
/// </summary>
public sealed record MeshGeometry(FVector[] Vertices, int[] Triangles, bool[] TriangleIsFoliage, byte[] TriangleColour)
{
    /// <summary>Average sampled albedo across the mesh's sampled sections (0,0,0 = nothing sampled → use palette).
    /// Used by the ground-cover pass to tint terrain with a single representative colour per grass/plant mesh.</summary>
    public (byte R, byte G, byte B) Representative { get; init; }
}

/// <summary>
/// Loads and caches a static mesh's LOD0 geometry (by asset path), classifying each triangle as foliage or
/// trunk from its material section and sampling each section's material albedo colour. LOD0 is used for full
/// detail (smooth cliffs, no facets) — and, conveniently, excludes the LOD billboard/imposter materials.
/// </summary>
public sealed class MeshGeometryCache
{
    private static readonly MeshGeometry Empty = new([], [], [], []);

    private readonly Dictionary<string, MeshGeometry> _cache = [];
    private readonly MaterialColourSampler _sampler = new();

    public int Count => _cache.Count;

    public int SampledMaterialCount => _sampler.Count;

    public MeshGeometry Get(FPackageIndex mesh)
    {
        var path = mesh.ResolvedObject?.GetPathName() ?? "";
        if (_cache.TryGetValue(path, out var cached))
        {
            return cached;
        }

        var geometry = Load(mesh);
        _cache[path] = geometry;
        return geometry;
    }

    private MeshGeometry Load(FPackageIndex mesh)
    {
        try
        {
            if (mesh.ResolvedObject?.Load() is not UStaticMesh staticMesh || staticMesh.RenderData?.LODs is not { Length: > 0 } lods)
            {
                return Empty;
            }

            var materials = staticMesh.StaticMaterials;
            foreach (var lod in lods)
            {
                if (lod?.PositionVertexBuffer?.Verts is not { Length: > 0 } vertices || lod.IndexBuffer is not { Length: > 2 } indexBuffer)
                {
                    continue;
                }

                var triangles = new int[indexBuffer.Length];
                for (var k = 0; k < indexBuffer.Length; k++)
                {
                    triangles[k] = (int)indexBuffer[k];
                }

                var triangleCount = indexBuffer.Length / 3;
                var triangleIsFoliage = new bool[triangleCount];
                var triangleColour = new byte[triangleCount * 3];
                if (lod.Sections != null)
                {
                    foreach (var section in lod.Sections)
                    {
                        var material = materials != null && section.MaterialIndex < materials.Length ? materials[section.MaterialIndex] : null;
                        var materialPath = material?.MaterialInterface?.GetPathName() ?? "";
                        var materialBaseName = materialPath.Contains('/') ? materialPath[(materialPath.LastIndexOf('/') + 1)..].Split('.')[0] : materialPath;
                        var isFoliage = TreeSectionClassifier.IsFoliageMaterial((material?.MaterialSlotName.Text ?? "") + " " + materialBaseName);
                        var colour = _sampler.Sample(material?.MaterialInterface?.Load() as UUnrealMaterial);

                        var first = (int)(section.FirstIndex / 3);
                        var last = Math.Min(triangleCount, (int)((section.FirstIndex + section.NumTriangles * 3) / 3));
                        for (var triangle = first; triangle < last && triangle >= 0; triangle++)
                        {
                            if (isFoliage)
                            {
                                triangleIsFoliage[triangle] = true;
                            }

                            if (colour is { } c)
                            {
                                triangleColour[triangle * 3] = c.R;
                                triangleColour[triangle * 3 + 1] = c.G;
                                triangleColour[triangle * 3 + 2] = c.B;
                            }
                        }
                    }
                }

                return new MeshGeometry(vertices, triangles, triangleIsFoliage, triangleColour)
                {
                    Representative = AverageSampled(triangleColour),
                };
            }
        }
        catch
        {
            // A mesh that fails to load contributes no relief — the same tolerant behaviour as before.
        }

        return Empty;
    }

    /// <summary>Mean of the non-zero (sampled) per-triangle colours, or (0,0,0) if nothing was sampled.</summary>
    private static (byte R, byte G, byte B) AverageSampled(byte[] triangleColour)
    {
        long r = 0, g = 0, b = 0, n = 0;
        for (var i = 0; i + 2 < triangleColour.Length; i += 3)
        {
            if (triangleColour[i] == 0 && triangleColour[i + 1] == 0 && triangleColour[i + 2] == 0)
            {
                continue;
            }

            r += triangleColour[i];
            g += triangleColour[i + 1];
            b += triangleColour[i + 2];
            n++;
        }

        return n == 0 ? default : ((byte)(r / n), (byte)(g / n), (byte)(b / n));
    }
}
