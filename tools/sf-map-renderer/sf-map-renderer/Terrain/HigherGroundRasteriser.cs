// The higher-ground pass: rasterises placed rock and flora mesh tops into the height grid with a
// max-Z buffer and records the topmost object per cell, leaving water classification to the
// pre-rock seabed.

using SfMapRenderer.Collection;
using SfMapRenderer.Configuration;
using SfMapRenderer.Diagnostics;
using SfMapRenderer.Landscape;
using SfMapRenderer.Meshes;
using SfMapRenderer.Rendering;

namespace SfMapRenderer.Terrain;

/// <summary>
/// The "higher ground" pass: rasterises placed rock and flora mesh tops into the height grid (max-Z
/// z-buffer), recording the height-ranked topmost object per cell. Water is classified on the pre-rock
/// seabed, so submerged spires render as islands on top of the water rather than punching holes in it.
/// </summary>
public static class HigherGroundRasteriser
{
    private const double DegreesToRadians = Math.PI / 180.0;

    public static void Rasterise(
        RenderState state,
        IReadOnlyList<PlacedMesh> meshes,
        int floraInstanceCount,
        int excludedRockCount,
        RenderOptions options,
        MeshGeometryCache cache,
        MacroPigment pigment,
        RockFootprintProbe? rockProbe)
    {
        var coral = meshes.Count(m => m.Kind == PlacedMeshKind.Coral);
        var tree = meshes.Count(m => m.Kind == PlacedMeshKind.Tree);
        Console.WriteLine($"higher-ground: rasterising {meshes.Count} instances (flora: {coral} coral + {tree} tree; {floraInstanceCount} from instanced foliage)...");

        var rockColourHeight = 300.0 * WorldFrame.HeightUnitsPerCm;
        var floraColourHeight = options.FloraColourHeightCm * WorldFrame.HeightUnitsPerCm;
        long raised = 0;

        // Dense grass/small-foliage doesn't z-buffer as canopy (its thin geometry can't fill a cell at map scale);
        // instead it accumulates a colour per cell and tints the terrain green — see BlendGroundCover.
        var groundCover = options.GroundCoverStrength > 0 ? new GroundCover(state.Frame.Width * state.Frame.Height) : null;

        foreach (var placed in meshes)
        {
            var geometry = cache.Get(placed.Mesh);
            if (geometry.Vertices.Length == 0 || geometry.Triangles.Length < 3)
            {
                continue;
            }

            var meshPath = placed.Mesh.ResolvedObject?.GetPathName() ?? "";
            var meshName = meshPath.Length > 0 ? meshPath[(meshPath.LastIndexOf('/') + 1)..].Split('.')[0] : "?";
            var colour = ObjectPalette.ColourFor(meshPath, placed.Kind);

            var (gridX, gridY, worldZ) = ProjectVertices(geometry.Vertices, placed, state.Frame);

            if (groundCover != null && placed.Kind == PlacedMeshKind.Tree
                && (meshPath.Contains("/Foliage/SmallFoliage/", StringComparison.Ordinal) || meshPath.Contains("/Foliage/Grass/", StringComparison.Ordinal)))
            {
                var tint = geometry.Representative != default ? geometry.Representative : colour;
                groundCover.Stamp(gridX, gridY, state.Frame, tint);
                continue;
            }

            // A stable per-instance colour jitter breaks up families of same-coloured rock (within a region).
            var jitter = placed.Kind == PlacedMeshKind.Rock
                ? RockJitter.Factor(placed.Location, options.RockJitter)
                : (1.0, 1.0, 1.0);

            raised += RasteriseTriangles(state, geometry, placed, gridX, gridY, worldZ, options, rockColourHeight, floraColourHeight, meshName, colour, pigment, jitter, rockProbe);

            if (placed.Kind == PlacedMeshKind.Tree)
            {
                StampTrunkDisc(state, geometry, gridX, gridY, worldZ, options);
            }
        }

        var tinted = groundCover?.Blend(state.ObjectColour, state.ObjectKind, options.GroundCoverStrength) ?? 0;
        Console.WriteLine($"higher-ground: {cache.Count} unique meshes ({cache.SampledMaterialCount} materials albedo-sampled), raised {raised} cells, {tinted} ground-cover-tinted, excluded {excludedRockCount} instances.");
        rockProbe?.Report();
    }

    /// <summary>Transform each vertex (scale → UE FRotationMatrix → translate) into grid-XY + world-Z.</summary>
    private static (double[] GridX, double[] GridY, double[] WorldZ) ProjectVertices(FVector[] vertices, PlacedMesh placed, WorldFrame frame)
    {
        double pitch = placed.Rotation.Pitch * DegreesToRadians, yaw = placed.Rotation.Yaw * DegreesToRadians, roll = placed.Rotation.Roll * DegreesToRadians;
        double cp = Math.Cos(pitch), sp = Math.Sin(pitch), cy = Math.Cos(yaw), sy = Math.Sin(yaw), cr = Math.Cos(roll), sr = Math.Sin(roll);
        double r00 = cp * cy, r01 = cp * sy, r02 = sp;
        double r10 = sr * sp * cy - cr * sy, r11 = sr * sp * sy + cr * cy, r12 = -sr * cp;
        double r20 = -(cr * sp * cy + sr * sy), r21 = cy * sr - cr * sp * sy, r22 = cr * cp;

        var gridX = new double[vertices.Length];
        var gridY = new double[vertices.Length];
        var worldZ = new double[vertices.Length];
        for (var k = 0; k < vertices.Length; k++)
        {
            var v = vertices[k];
            double sx = v.X * placed.Scale.X, syv = v.Y * placed.Scale.Y, sz = v.Z * placed.Scale.Z;
            var wx = placed.Location.X + sx * r00 + syv * r10 + sz * r20;
            var wy = placed.Location.Y + sx * r01 + syv * r11 + sz * r21;
            var wz = placed.Location.Z + sx * r02 + syv * r12 + sz * r22;
            gridX[k] = frame.FractionalColumn(wx);
            gridY[k] = frame.FractionalRow(wy);
            worldZ[k] = wz;
        }

        return (gridX, gridY, worldZ);
    }

    private static long RasteriseTriangles(
        RenderState state, MeshGeometry geometry, PlacedMesh placed,
        double[] gridX, double[] gridY, double[] worldZ, RenderOptions options,
        double rockColourHeight, double floraColourHeight, string meshName, (byte R, byte G, byte B) colour, MacroPigment pigment,
        (double R, double G, double B) jitter, RockFootprintProbe? rockProbe)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var heightGrid = state.Height;
        var baseHeight = state.BaseHeight;
        var isRock = state.IsRock;
        var objectKind = state.ObjectKind;
        var objectColour = state.ObjectColour;
        var triangles = geometry.Triangles;
        var isFoliage = geometry.TriangleIsFoliage;
        var sampled = geometry.TriangleColour;
        var isTree = placed.Kind == PlacedMeshKind.Tree;
        var isFlora = placed.Kind is PlacedMeshKind.Coral or PlacedMeshKind.Tree;
        // Coral (emissive glow, missed by albedo) and DesertRock (a virtual-textured blend that doesn't decode,
        // and which should track the sand) keep their fixed palette colour instead of the sampled albedo.
        var usePalette = placed.Kind == PlacedMeshKind.Coral || meshName.Contains("DesertRock", StringComparison.OrdinalIgnoreCase);
        byte objectValue = placed.Kind switch { PlacedMeshKind.Rock => 1, PlacedMeshKind.Coral => 2, _ => 3 };
        var colourThreshold = isFlora ? floraColourHeight : rockColourHeight;
        long raised = 0;

        for (var t = 0; t + 2 < triangles.Length; t += 3)
        {
            var triangle = t / 3;
            var triangleIsFoliage = isTree && triangle < isFoliage.Length && isFoliage[triangle];

            // This section's sampled material colour, or the fixed palette colour (0,0,0 when unsampled, or when
            // the family is forced to the palette — see usePalette).
            byte cr = colour.R, cg = colour.G, cb = colour.B;
            if (!usePalette
                && triangle * 3 + 2 < sampled.Length && (sampled[triangle * 3] != 0 || sampled[triangle * 3 + 1] != 0 || sampled[triangle * 3 + 2] != 0))
            {
                cr = sampled[triangle * 3];
                cg = sampled[triangle * 3 + 1];
                cb = sampled[triangle * 3 + 2];
            }

            if (isTree && options.TreePart != TreePart.Both)
            {
                if (options.TreePart == TreePart.Trunk && triangleIsFoliage)
                {
                    continue;
                }

                if (options.TreePart == TreePart.Foliage && !triangleIsFoliage)
                {
                    continue;
                }
            }

            int i0 = triangles[t], i1 = triangles[t + 1], i2 = triangles[t + 2];
            if (i0 >= gridX.Length || i1 >= gridX.Length || i2 >= gridX.Length)
            {
                continue;
            }

            double ax = gridX[i0], ay = gridY[i0], az = worldZ[i0];
            double bx = gridX[i1], by = gridY[i1], bz = worldZ[i1];
            double cx = gridX[i2], cy = gridY[i2], cz = worldZ[i2];

            int x0 = (int)Math.Floor(Math.Min(ax, Math.Min(bx, cx))), x1 = (int)Math.Ceiling(Math.Max(ax, Math.Max(bx, cx)));
            int y0 = (int)Math.Floor(Math.Min(ay, Math.Min(by, cy))), y1 = (int)Math.Ceiling(Math.Max(ay, Math.Max(by, cy)));
            if (x1 < 0 || y1 < 0 || x0 >= width || y0 >= height)
            {
                continue;
            }

            if (x1 - x0 > 150 || y1 - y0 > 150)
            {
                continue;
            }

            x0 = Math.Max(0, x0);
            y0 = Math.Max(0, y0);
            x1 = Math.Min(width - 1, x1);
            y1 = Math.Min(height - 1, y1);

            var denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
            if (Math.Abs(denominator) < 1e-9)
            {
                continue;
            }

            if (Math.Abs(denominator) < 0.4 && (x1 - x0 > 12 || y1 - y0 > 12))
            {
                continue;
            }

            for (var py = y0; py <= y1; py++)
            {
                for (var px = x0; px <= x1; px++)
                {
                    var l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator;
                    var l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator;
                    var l3 = 1 - l1 - l2;
                    if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02)
                    {
                        continue;
                    }

                    var z = l1 * az + l2 * bz + l3 * cz;
                    var height16 = frame.ZToHeight16(z);
                    var index = py * width + px;
                    var aboveThreshold = height16 - baseHeight[index] > colourThreshold;
                    if (height16 > heightGrid[index])
                    {
                        heightGrid[index] = (float)height16;
                        if (aboveThreshold)
                        {
                            if (placed.Kind == PlacedMeshKind.Rock)
                            {
                                isRock[index] = true;
                            }

                            objectKind[index] = objectValue;
                            if (placed.Kind == PlacedMeshKind.Rock)
                            {
                                // Per-instance jitter (breaks up same-family rock) then the world-aligned macro
                                // pigment (so desert rock reads orange with the sand, red-jungle rock reddish).
                                var jr = (byte)Math.Clamp(cr * jitter.R, 0, 255);
                                var jg = (byte)Math.Clamp(cg * jitter.G, 0, 255);
                                var jb = (byte)Math.Clamp(cb * jitter.B, 0, 255);
                                var (pr, pg, pb) = pigment.Apply((jr, jg, jb), (double)px / width, (double)py / height);
                                objectColour[index * 3] = pr;
                                objectColour[index * 3 + 1] = pg;
                                objectColour[index * 3 + 2] = pb;
                            }
                            else
                            {
                                objectColour[index * 3] = cr;
                                objectColour[index * 3 + 1] = cg;
                                objectColour[index * 3 + 2] = cb;
                            }
                        }

                        raised++;
                    }

                    rockProbe?.Observe(px, py, meshName, placed.Location.X, placed.Location.Y, z, placed.Scale.Z);
                }
            }
        }

        return raised;
    }

    /// <summary>
    /// A trunk mesh is a hollow tube, so rasterising its wall gives a ring. Instead take a horizontal slice
    /// of the trunk-section vertices at <c>TRUNKBAND</c> above the highest ground the footprint touches, and
    /// fill the disc enclosing the slice points.
    /// </summary>
    private static void StampTrunkDisc(RenderState state, MeshGeometry geometry, double[] gridX, double[] gridY, double[] worldZ, RenderOptions options)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var baseHeight = state.BaseHeight;
        var trunkMask = state.TrunkMask;
        var triangles = geometry.Triangles;
        var isFoliage = geometry.TriangleIsFoliage;

        var groundHigh = -1e18;
        for (var t = 0; t + 2 < triangles.Length; t += 3)
        {
            if (t / 3 < isFoliage.Length && isFoliage[t / 3])
            {
                continue;
            }

            for (var e = 0; e < 3; e++)
            {
                var vertex = triangles[t + e];
                if (vertex >= gridX.Length)
                {
                    continue;
                }

                int column = (int)Math.Round(gridX[vertex]), row = (int)Math.Round(gridY[vertex]);
                if (column < 0 || row < 0 || column >= width || row >= height)
                {
                    continue;
                }

                var landHeight = baseHeight[row * width + column];
                if (landHeight != 0)
                {
                    groundHigh = Math.Max(groundHigh, frame.HeightToZ(landHeight));
                }
            }
        }

        if (groundHigh <= -1e17)
        {
            return;
        }

        var sliceZ = groundHigh + options.TrunkBandCm;
        double sumX = 0, sumY = 0;
        var count = 0;
        var points = new List<(double X, double Y)>();
        for (var t = 0; t + 2 < triangles.Length; t += 3)
        {
            if (t / 3 < isFoliage.Length && isFoliage[t / 3])
            {
                continue;
            }

            for (var e = 0; e < 3; e++)
            {
                var vertex = triangles[t + e];
                if (vertex >= gridX.Length)
                {
                    continue;
                }

                if (Math.Abs(worldZ[vertex] - sliceZ) < 150)
                {
                    points.Add((gridX[vertex], gridY[vertex]));
                    sumX += gridX[vertex];
                    sumY += gridY[vertex];
                    count++;
                }
            }
        }

        if (count < 3)
        {
            return;
        }

        double centreX = sumX / count, centreY = sumY / count;
        var distances = points
            .Select(p => Math.Sqrt((p.X - centreX) * (p.X - centreX) + (p.Y - centreY) * (p.Y - centreY)))
            .OrderBy(d => d)
            .ToList();
        var radius = Math.Min(8.0, Math.Max(0.6, distances[(int)(distances.Count * 0.75)]));

        int gx0 = Math.Max(0, (int)(centreX - radius)), gx1 = Math.Min(width - 1, (int)Math.Ceiling(centreX + radius));
        int gy0 = Math.Max(0, (int)(centreY - radius)), gy1 = Math.Min(height - 1, (int)Math.Ceiling(centreY + radius));
        for (var gy = gy0; gy <= gy1; gy++)
        {
            for (var gx = gx0; gx <= gx1; gx++)
            {
                if ((gx - centreX) * (gx - centreX) + (gy - centreY) * (gy - centreY) <= radius * radius)
                {
                    trunkMask[gy * width + gx] = true;
                }
            }
        }
    }
}
