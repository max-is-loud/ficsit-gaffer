// Pass A of the render: accumulates landscape tiles, placed rock and flora meshes, water volumes,
// rivers and shallow-water seeds as RenderPipeline feeds it each package's exports through the
// TryAdd* methods. The package sweep itself lives in RenderPipeline.

using CUE4Parse.UE4.Assets.Exports.Component.Landscape;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;

using SfMapRenderer.Assets;
using SfMapRenderer.Configuration;
using SfMapRenderer.Meshes;

namespace SfMapRenderer.Collection;

/// <summary>
/// Pass A: sweeps the landscape cells and the persistent level, accumulating everything the render
/// needs — landscape tiles, placed rock/flora meshes, water volumes, rivers and shallow-water seeds.
/// Each <c>TryAdd*</c> mirrors the corresponding routine in the original single-file renderer so the
/// collected order (and therefore the rasterise/z-buffer order) is preserved exactly.
/// </summary>
public sealed class SceneCollector
{
    private readonly RenderOptions _options;
    private readonly MaterialColourSampler _grassSampler = new();
    private readonly Dictionary<string, (byte R, byte G, byte B)?> _grassColour = new(StringComparer.Ordinal);

    public SceneCollector(RenderOptions options)
    {
        _options = options;
    }

    public List<LandscapeTile> Tiles { get; } = [];
    public List<WaterBodySeed> WaterSeeds { get; } = [];
    public List<PlacedMesh> Meshes { get; } = [];
    public List<WaterVolumeFace> WaterVolumes { get; } = [];
    public List<RiverActor> Rivers { get; } = [];
    public int FloraInstanceCount { get; private set; }
    public int ExcludedRockCount { get; private set; }

    /// <summary>A landscape tile — its section base plus height and weightmap textures.</summary>
    public void TryAddTile(UObject export)
    {
        if (export.ExportType != "LandscapeComponent")
        {
            return;
        }

        if (export.GetOrDefault<UObject?>("HeightmapTexture") is not UTexture2D heightmap)
        {
            return;
        }

        var weightmaps = export.GetOrDefault<UTexture2D[]>("WeightmapTextures") ?? [];
        var rawAllocations = export.GetOrDefault<FStructFallback[]>("WeightmapLayerAllocations") ?? [];
        var allocations = rawAllocations
            .Select(a => new WeightmapAllocation(
                a.GetOrDefault<UObject?>("LayerInfo")?.Name?.Replace("_LayerInfo", "", StringComparison.Ordinal) ?? "",
                a.GetOrDefault<byte>("WeightmapTextureIndex"),
                a.GetOrDefault<byte>("WeightmapTextureChannel")))
            .Where(a => a.Layer.Length > 0)
            .ToArray();

        // The landscape material instance carries every layer's diffuse texture + tint (all tiles share it).
        var material = (export.GetOrDefault<UObject[]?>("MaterialInstances") ?? [])
            .OfType<UUnrealMaterial>()
            .FirstOrDefault()
            ?? export.GetOrDefault<UObject?>("OverrideMaterial") as UUnrealMaterial;

        var (grassOverlay, grassStride) = _options.GrassStrength > 0 && export is ULandscapeComponent lc
            ? BuildGrassOverlay(lc)
            : (null, 0);

        Tiles.Add(new LandscapeTile(
            export.GetOrDefault<int>("SectionBaseX"),
            export.GetOrDefault<int>("SectionBaseY"),
            heightmap,
            weightmaps,
            allocations,
            material)
        {
            GrassOverlay = grassOverlay,
            GrassStride = grassStride,
        });
    }

    // A grass type is "vegetation" (a grass carpet that colours the ground) rather than pebble/twig debris.
    private static bool IsVegetationGrass(string name) =>
        name.Contains("Grass", StringComparison.OrdinalIgnoreCase)
        || name.Contains("Forest", StringComparison.OrdinalIgnoreCase)
        || name.Contains("Jungle", StringComparison.OrdinalIgnoreCase)
        || name.Equals("CoralRock", StringComparison.OrdinalIgnoreCase);

    // Debug palette: flat colour per grass-type family so the baked grass map is legible at a glance.
    private static (byte R, byte G, byte B) DebugGrassColour(string name) =>
        name.Contains("Red", StringComparison.OrdinalIgnoreCase) || name.Contains("Pink", StringComparison.OrdinalIgnoreCase) ? ((byte)220, (byte)40, (byte)40)
        : name.Contains("Grass", StringComparison.OrdinalIgnoreCase) || name.Contains("Forest", StringComparison.OrdinalIgnoreCase) || name.Contains("Jungle", StringComparison.OrdinalIgnoreCase) || name.Equals("CoralRock", StringComparison.OrdinalIgnoreCase) ? ((byte)30, (byte)200, (byte)30)
        : name.Contains("Gravel", StringComparison.OrdinalIgnoreCase) ? ((byte)120, (byte)120, (byte)120)
        : name.Contains("Soil", StringComparison.OrdinalIgnoreCase) ? ((byte)120, (byte)90, (byte)55)
        : name.Contains("Sand", StringComparison.OrdinalIgnoreCase) ? ((byte)210, (byte)185, (byte)140)
        : ((byte)255, (byte)0, (byte)255);

    /// <summary>
    /// Turn the component's baked Landscape-Grass density into a per-vertex overlay (R,G,B, coverage): the
    /// density-weighted colour of the vegetation grass types present, and their summed density as coverage.
    /// In debug mode, instead colour every vertex by its DOMINANT grass type (all types) at full coverage.
    /// </summary>
    private (byte[]? Overlay, int Stride) BuildGrassOverlay(ULandscapeComponent lc)
    {
        var grass = lc.GrassData;
        if (grass?.WeightOffsets is not { Count: > 0 } || grass.HeightWeightData is not { Length: > 0 } data)
        {
            return (null, 0);
        }

        var stride0 = lc.SubsectionSizeQuads * lc.NumSubsections + 1;
        if (_options.GrassDebug)
        {
            var all = grass.WeightOffsets.Select(kv => (Name: kv.Key.ResolvedObject?.Name.Text ?? "?", kv.Value)).ToArray();
            var dbg = new byte[grass.NumElements * 4];
            for (var i = 0; i < grass.NumElements; i++)
            {
                byte best = 0; var name = "";
                foreach (var (nm, off) in all)
                {
                    if (off + i < data.Length && data[off + i] > best) { best = data[off + i]; name = nm; }
                }

                if (best == 0)
                {
                    continue;
                }

                var (r, g, b) = DebugGrassColour(name);
                dbg[i * 4] = r; dbg[i * 4 + 1] = g; dbg[i * 4 + 2] = b; dbg[i * 4 + 3] = 255;
            }

            return (dbg, stride0);
        }

        var veg = grass.WeightOffsets
            .Where(kv => IsVegetationGrass(kv.Key.ResolvedObject?.Name.Text ?? ""))
            .Select(kv => (kv.Value, Colour: GrassColour(kv.Key)))
            .Where(t => t.Colour is not null)
            .Select(t => (Offset: t.Value, Colour: t.Colour!.Value))
            .ToArray();
        if (veg.Length == 0)
        {
            return (null, 0);
        }

        var num = grass.NumElements;
        var stride = lc.SubsectionSizeQuads * lc.NumSubsections + 1;
        var overlay = new byte[num * 4];
        for (var i = 0; i < num; i++)
        {
            long sumW = 0, r = 0, g = 0, b = 0;
            foreach (var (offset, colour) in veg)
            {
                if (offset + i >= data.Length)
                {
                    continue;
                }

                int d = data[offset + i];
                sumW += d;
                r += d * colour.R;
                g += d * colour.G;
                b += d * colour.B;
            }

            if (sumW == 0)
            {
                continue;
            }

            overlay[i * 4] = (byte)(r / sumW);
            overlay[i * 4 + 1] = (byte)(g / sumW);
            overlay[i * 4 + 2] = (byte)(b / sumW);
            overlay[i * 4 + 3] = (byte)Math.Min(255, sumW);
        }

        return (overlay, stride);
    }

    // Colour of a grass type's carpet, DERIVED from game data (no hardcoded palette): the albedo of its primary
    // leafy grass mesh multiplied by that material's "Color Tint" parameter — this is what makes Grass read green,
    // GrassRed red, etc. Cached per grass type; null if nothing in the type decodes.
    private (byte R, byte G, byte B)? GrassColour(FPackageIndex grassTypeIndex)
    {
        var key = grassTypeIndex.ResolvedObject?.Name.Text ?? grassTypeIndex.ResolvedObject?.GetPathName() ?? "";
        if (_grassColour.TryGetValue(key, out var cached))
        {
            return cached;
        }

        var colour = DeriveGrassColour(grassTypeIndex);
        _grassColour[key] = colour;
        return colour;
    }

    private (byte R, byte G, byte B)? DeriveGrassColour(FPackageIndex grassTypeIndex)
    {
        var varieties = grassTypeIndex.ResolvedObject?.Load()?.GetOrDefault<FStructFallback[]?>("GrassVarieties") ?? [];
        (byte R, byte G, byte B)? anyAlbedo = null;
        foreach (var v in varieties)
        {
            var meshIndex = v.GetOrDefault<FPackageIndex?>("GrassMesh");
            var meshPath = meshIndex?.ResolvedObject?.GetPathName();
            if (meshPath == null
                || meshIndex!.ResolvedObject?.Load() is not UStaticMesh mesh
                || mesh.StaticMaterials is not { Length: > 0 } mats
                || mats[0].MaterialInterface?.Load() is not UUnrealMaterial material
                || _grassSampler.Sample(material) is not { } albedo)
            {
                continue;
            }

            anyAlbedo ??= albedo;

            // The carpet colour is the leafy foliage, not the scattered pebbles/twigs a grass type also spawns.
            if (!meshPath.Contains("/Foliage/", StringComparison.Ordinal) && !meshPath.Contains("/Grass/", StringComparison.Ordinal))
            {
                continue;
            }

            var (tr, tg, tb) = GrassTint(material);
            return (Tinted(albedo.R, tr), Tinted(albedo.G, tg), Tinted(albedo.B, tb));
        }

        // No leafy variety decoded — fall back to any variety's real sampled albedo (still game data), else skip.
        return anyAlbedo;
    }

    // The material's "Color Tint" multiplier (identity when absent — not a colour, just "untinted").
    private static (float R, float G, float B) GrassTint(UUnrealMaterial material)
    {
        try
        {
            var parameters = new CMaterialParams2();
            material.GetParams(parameters, EMaterialFormat.AllLayers);
            if (parameters.Colors.TryGetValue("Color Tint", out var tint))
            {
                return (tint.R, tint.G, tint.B);
            }
        }
        catch
        {
            // Untinted.
        }

        return (1f, 1f, 1f);
    }

    private static byte Tinted(byte albedo, float tint) => (byte)Math.Clamp(albedo * Math.Clamp(tint, 0f, 1f), 0, 255);

    /// <summary>A shallow water body: its visual WaterSurface plane (location + scale + yaw in degrees).</summary>
    public void TryAddWaterSeed(UObject export)
    {
        if (!export.ExportType.Contains("Water", StringComparison.Ordinal))
        {
            return;
        }

        var surface = export.GetOrDefault<UObject?>("WaterSurface");
        if (surface == null || !surface.HasRelativeLocation())
        {
            return;
        }

        var location = surface.RelativeLocation();
        var scale = surface.RelativeScale();
        var yawDegrees = surface.Properties.Any(p => p.Name.Text == "RelativeRotation")
            ? surface.GetOrDefault<FRotator>("RelativeRotation").Yaw
            : 0.0;

        WaterSeeds.Add(new WaterBodySeed(location.X, location.Y, location.Z, scale.X, scale.Y, yawDegrees));
    }

    /// <summary>A placed rock or flora mesh (individual component or, for flora, instanced foliage).</summary>
    public void TryAddMesh(UObject export)
    {
        var type = export.ExportType;

        // "…StaticMeshComponent" covers stock components; "…InstancedSMC" covers Satisfactory's custom
        // FGFoliageInstancedSMC — the ~3.3M-instance bulk of world foliage (see base-map-foliage-decode.md).
        if (!type.Contains("StaticMeshComponent", StringComparison.Ordinal)
            && !type.Contains("InstancedSMC", StringComparison.Ordinal))
        {
            return;
        }

        // HLOD components are low-detail merged proxies for distant streaming; the real instances are also present
        // as foliage/individual components, so rendering the proxy too double-plants the same tree/rock. Skip them.
        if (type.Contains("HLOD", StringComparison.Ordinal))
        {
            return;
        }

        var mesh = export.MeshIndex();
        var path = mesh?.ResolvedObject?.GetPathName();
        if (path == null)
        {
            return;
        }

        var kind = ClassifyMesh(path);
        if (kind == null)
        {
            return;
        }

        // Instanced foliage (FoliageInstancedStaticMeshComponent) has no RelativeLocation — its transforms
        // live in the serialized instance buffer. Individual placements take the branch below.
        if (!export.HasRelativeLocation())
        {
            if (kind is PlacedMeshKind.Coral or PlacedMeshKind.Tree
                && export is UInstancedStaticMeshComponent instanced
                && instanced.PerInstanceSMData is { Length: > 0 } instances)
            {
                // Stock foliage stores per-instance translations relative to TranslatedInstanceSpaceOrigin.
                // FGFoliageInstancedSMC stores them relative to the owning InstancedFoliageActor's cell:
                // the km-scale offset lives on the actor RootComponent (this component's AttachParent), and
                // TranslatedInstanceSpaceOrigin is only instance[0] — adding it would double-count.
                var origin = export.GetOrDefault<FVector>("TranslatedInstanceSpaceOrigin");
                if (type == "FGFoliageInstancedSMC")
                {
                    var attach = export.GetOrDefault<UObject?>("AttachParent");
                    origin = attach is { } a && a.HasRelativeLocation() ? a.RelativeLocation() : new FVector(0, 0, 0);
                }

                foreach (var instance in instances)
                {
                    var transform = instance.TransformData;
                    var world = new FVector(
                        origin.X + transform.Translation.X,
                        origin.Y + transform.Translation.Y,
                        origin.Z + transform.Translation.Z);
                    Meshes.Add(new PlacedMesh(mesh!, world, transform.Rotation.Rotator(), transform.Scale3D, kind.Value));
                    FloraInstanceCount++;
                }
            }

            return;
        }

        var location = export.RelativeLocation();
        if (kind == PlacedMeshKind.Rock && IsExcluded(path, location))
        {
            ExcludedRockCount++;
            return;
        }

        Meshes.Add(new PlacedMesh(mesh!, location, export.RelativeRotation(), export.RelativeScale(), kind.Value));
    }

    /// <summary>A BP_River actor: its transform plus every SM_RiverPlane spline segment.</summary>
    public void TryAddRiver(UObject export)
    {
        if (export.ExportType != "BP_River_PROT_C")
        {
            return;
        }

        var root = export.GetOrDefault<UObject?>("RootComponent");
        if (root == null || !root.HasRelativeLocation())
        {
            return;
        }

        var splineMeshes = export.GetOrDefault<UScriptArray?>("mSplineMeshComponents");
        if (splineMeshes == null)
        {
            return;
        }

        var segments = new List<RiverSegment>();
        foreach (var entry in splineMeshes.Properties)
        {
            var splineMesh = (entry.GenericValue as FPackageIndex)?.ResolvedObject?.Load();
            var rawParams = splineMesh?.Properties.FirstOrDefault(p => p.Name.Text == "SplineParams")?.Tag?.GenericValue;
            var splineParams = rawParams as FStructFallback ?? (rawParams as FScriptStruct)?.StructType as FStructFallback;
            if (splineParams == null)
            {
                continue;
            }

            object? Field(string name) => splineParams.Properties.FirstOrDefault(p => p.Name.Text == name)?.Tag?.GenericValue;
            segments.Add(new RiverSegment(
                AsVector(Field("StartPos")), AsVector(Field("StartTangent")),
                AsVector(Field("EndPos")), AsVector(Field("EndTangent")),
                AsScaleX(Field("StartScale")), AsScaleX(Field("EndScale"))));
        }

        if (segments.Count > 0)
        {
            Rivers.Add(new RiverActor(root.RelativeLocation(), root.RelativeYawRadians(), root.RelativeScale(), segments));
        }
    }

    /// <summary>An FGWaterVolume brush: each convex BSP face transformed to a world-XY polygon + surface Z.</summary>
    public void TryAddWaterVolume(UObject export)
    {
        if (export.ExportType != "FGWaterVolume")
        {
            return;
        }

        var root = export.GetOrDefault<UObject?>("RootComponent");
        if (root?.GetOrDefault<UObject?>("Brush") is not UModel brush
            || brush.Points is not { Length: > 0 } points
            || brush.Nodes is not { Length: > 0 } nodes
            || brush.Verts is not { Length: > 0 } verts)
        {
            return;
        }

        var location = root.RelativeLocation();
        var scale = root.RelativeScale();
        var yaw = root.RelativeYawRadians();
        double cos = Math.Cos(yaw), sin = Math.Sin(yaw);

        double surfaceZ = -1e18, minZ = 1e18;
        foreach (var point in points)
        {
            var z = location.Z + point.Z * scale.Z;
            surfaceZ = Math.Max(surfaceZ, z);
            minZ = Math.Min(minZ, z);
        }

        (double X, double Y) ToWorld(FVector point)
        {
            double sx = point.X * scale.X, sy = point.Y * scale.Y;
            return (location.X + sx * cos - sy * sin, location.Y + sx * sin + sy * cos);
        }

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
                WaterVolumes.Add(new WaterVolumeFace(polygon, surfaceZ, minZ));
            }
        }
    }

    private PlacedMeshKind? ClassifyMesh(string path)
    {
        if (path.Contains("/Environment/Rock/", StringComparison.Ordinal))
        {
            return PlacedMeshKind.Rock;
        }

        foreach (var folder in _options.FloraFolders)
        {
            if (path.Contains(folder, StringComparison.Ordinal))
            {
                return path.Contains("/Coral/", StringComparison.Ordinal) ? PlacedMeshKind.Coral : PlacedMeshKind.Tree;
            }
        }

        return null;
    }

    private bool IsExcluded(string path, FVector location) =>
        _options.RockExclusions.Any(x =>
            path.Contains(x.MeshName + ".", StringComparison.Ordinal)
            && Math.Abs(location.X - x.X) < 10000
            && Math.Abs(location.Y - x.Y) < 10000);

    private static FVector AsVector(object? value)
    {
        if (value is FScriptStruct scriptStruct)
        {
            value = scriptStruct.StructType;
        }

        return value switch
        {
            FVector vector => vector,
            FStructFallback fallback => new FVector(fallback.GetOrDefault<float>("X"), fallback.GetOrDefault<float>("Y"), fallback.GetOrDefault<float>("Z")),
            _ => new FVector(0, 0, 0),
        };
    }

    private static double AsScaleX(object? value)
    {
        if (value is FScriptStruct scriptStruct)
        {
            value = scriptStruct.StructType;
        }

        return value switch
        {
            FVector2D vector2 => vector2.X,
            FStructFallback fallback => fallback.GetOrDefault<float>("X"),
            _ => 1.0,
        };
    }
}
