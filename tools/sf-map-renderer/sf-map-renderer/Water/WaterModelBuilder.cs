// Applies the water model to the render state in the game's order: ocean-void flood, water-volume
// rasterise, margin override, river ribbons, shallow ponds and the wet-sand shelf.

using SfMapRenderer.Collection;
using SfMapRenderer.Configuration;
using SfMapRenderer.Geometry;
using SfMapRenderer.Rendering;

namespace SfMapRenderer.Water;

/// <summary>
/// Lays the water model onto the render state, in the game's own geometry order: flood the border-connected
/// void, rasterise the FGWaterVolume footprints (unifying the ocean band and flagging ocean-void), apply the
/// blue-box margin override, stamp river ribbons and shallow ponds, then flood the wet-sand shelf. Each step
/// is a separate call so the CELLS/PROBEXY probes can slot in between the ponds and the wet-sand flood, and
/// ztest before any of it — exactly as the original early-returns did.
/// </summary>
public static class WaterModelBuilder
{
    private static bool IsOceanBand(double z) => z >= -1850 && z <= -1600;

    /// <summary>The real sea: void connected to the map border. Inland data-gap void is not sea.</summary>
    public static void FloodOceanVoid(RenderState state)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var heightGrid = state.Height;
        var oceanVoid = state.OceanVoid;
        var queue = new Queue<int>();

        void Seed(int i)
        {
            if (!oceanVoid[i] && heightGrid[i] == 0)
            {
                oceanVoid[i] = true;
                queue.Enqueue(i);
            }
        }

        for (var x = 0; x < width; x++)
        {
            Seed(x);
            Seed((height - 1) * width + x);
        }

        for (var y = 0; y < height; y++)
        {
            Seed(y * width);
            Seed(y * width + width - 1);
        }

        while (queue.Count > 0)
        {
            var i = queue.Dequeue();
            int cx = i % width, cy = i / width;
            if (cx > 0)
            {
                Seed(i - 1);
            }

            if (cx < width - 1)
            {
                Seed(i + 1);
            }

            if (cy > 0)
            {
                Seed(i - width);
            }

            if (cy < height - 1)
            {
                Seed(i + width);
            }
        }
    }

    /// <summary>
    /// Render the whole river channel uniformly light, not just the narrow ribbon. The mid-river ribbon is drawn
    /// as a flat shallow sheet, but the wider FGWaterVolume water on the banks keeps an inflated surface and reads
    /// darker than the ribbon beside it. This flood-fills the flowing flag from the river across the connected
    /// deep channel water (depth &gt; <see cref="RenderOptions.FlowingBankDepthCm"/>) so the banks match the
    /// centre. Shallow water is already ~ribbon-light so it is skipped and blocks the spread, and the fill only
    /// reaches <see cref="RenderOptions.ChannelReachCm"/> from a river centreline, so a deep lake merely touched
    /// by a river keeps its interior depth shading. The ocean is never touched.
    /// </summary>
    public static void SpreadFlowingWater(RenderState state, RenderOptions options)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var heightGrid = state.Height;
        var isOcean = state.IsOcean;
        var isLake = state.IsLake;
        var isRiver = state.IsRiver;
        var waterZ = state.WaterZ;
        var threshold = options.FlowingBankDepthCm;
        var maxReach = (int)Math.Round(options.ChannelReachCm / frame.CellWidthCm);
        var distance = new int[width * height];
        Array.Fill(distance, -1);
        var queue = new Queue<int>();

        for (var i = 0; i < width * height; i++)
        {
            if (isRiver[i])
            {
                distance[i] = 0;
                queue.Enqueue(i);
            }
        }

        long marked = 0;

        void Try(int from, int j)
        {
            if (distance[j] != -1)
            {
                return; // already reached (multi-source BFS gives the min distance)
            }

            distance[j] = distance[from] + 1;
            if (distance[j] > maxReach || !(isOcean[j] || isLake[j]) || heightGrid[j] == 0)
            {
                return; // out of reach, or not inland water — also blocks the spread past here
            }

            var surface = waterZ[j] != 0 ? waterZ[j] : options.OceanZ;
            if (IsOceanBand(surface) || surface - frame.HeightToZ(heightGrid[j]) <= threshold)
            {
                return; // the sea, or shallow water already ~ribbon-light — leave it and stop here
            }

            isRiver[j] = true; // deep channel water beside the river — render it flowing, like the ribbon
            marked++;
            queue.Enqueue(j);
        }

        while (queue.Count > 0)
        {
            var i = queue.Dequeue();
            int cx = i % width, cy = i / width;
            if (cx > 0) { Try(i, i - 1); }
            if (cx < width - 1) { Try(i, i + 1); }
            if (cy > 0) { Try(i, i - width); }
            if (cy < height - 1) { Try(i, i + width); }
        }

        Console.WriteLine($"flowing-water spread: {marked} bank cells (reach {maxReach} cells, depth > {threshold:F0})");
    }

    /// <summary>
    /// Flood terrain that sits below sea level and is connected (4-neighbour) to the open ocean — an under-water
    /// channel the game flattened the landscape for but whose water body carries no actor we parse (e.g. the U10
    /// cascade outflow). Self-limiting: banks above sea level stop the fill.
    /// </summary>
    public static void FloodSubSeaConnected(RenderState state, RenderOptions options)
    {
        if (!options.FloodSubSea)
        {
            return;
        }

        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var heightGrid = state.Height;
        var baseHeight = state.BaseHeight;
        var isOcean = state.IsOcean;
        var oceanVoid = state.OceanVoid;
        var waterZ = state.WaterZ;
        var surface = options.OceanZ;
        var cellCount = width * height;
        var visited = new bool[cellCount];
        var queue = new Queue<int>();

        // Seed from the open sea (flooded void ocean + ocean-band classified sea).
        for (var i = 0; i < cellCount; i++)
        {
            if (oceanVoid[i] || (isOcean[i] && IsOceanBand(waterZ[i] != 0 ? waterZ[i] : surface)))
            {
                visited[i] = true;
                queue.Enqueue(i);
            }
        }

        long filled = 0;

        void Try(int j)
        {
            if (visited[j])
            {
                return;
            }

            visited[j] = true;
            if (heightGrid[j] == 0 || isOcean[j] || state.IsLake[j])
            {
                return; // void (handled elsewhere) or already water
            }

            var terrainZ = frame.HeightToZ(baseHeight[j] != 0 ? baseHeight[j] : heightGrid[j]);
            if (terrainZ >= surface || terrainZ < surface - options.SubSeaMaxDepthCm)
            {
                // Above sea level = a bank; far below = a deep dry basin the game doesn't flood. Stop either way.
                return;
            }

            isOcean[j] = true;
            waterZ[j] = surface;
            filled++;
            queue.Enqueue(j);
        }

        while (queue.Count > 0)
        {
            var i = queue.Dequeue();
            int cx = i % width, cy = i / width;
            if (cx > 0) { Try(i - 1); }
            if (cx < width - 1) { Try(i + 1); }
            if (cy > 0) { Try(i - width); }
            if (cy < height - 1) { Try(i + width); }
        }

        Console.WriteLine($"sub-sea flood: filled={filled} cells below {surface:F0}");
    }

    /// <summary>How far below a volume's box floor (minZ) a cell's terrain may sit and still be flooded (cm).
    /// A water box encloses its water, so ground far below the box floor isn't under that water — this rejects
    /// a tall volume's footprint spilling over a cliff edge onto much lower terrain (a deep, dark over-flood).</summary>
    private const double VolumeFloorToleranceCm = 3000.0;

    /// <summary>Max distance from a volume's root origin to accept a BP_Water plane as its surface (cm). Large
    /// enough to reach the plane of a big river/lake system (e.g. the Titan River Valley volumes sit ~340 m
    /// from their nearest plane); nearest-wins keeps each volume paired to its own body.</summary>
    private const double SurfacePairRadiusCm = 50000.0;

    /// <summary>
    /// Rasterise every FGWaterVolume face: a cell is water where the seabed is at/below the volume's surface.
    /// Sea-band volumes snap to the unified <c>OCEANZ</c>; an inland volume takes the Z of its paired
    /// <c>BP_Water</c> surface plane (the real water level) rather than its bounding-box top, which can sit
    /// several metres above the water and flood the shore. Void cells inside an ocean-band volume become
    /// ocean-void (blue). Overlaps keep the highest surface.
    /// </summary>
    public static void RasteriseVolumes(RenderState state, IReadOnlyList<WaterVolumeFace> volumes, IReadOnlyList<WaterBodySeed> seeds, RenderOptions options, int traceIndex = -1)
    {
        Console.WriteLine($"water-volume rasterise ({volumes.Count} FGWaterVolume faces)...");
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var baseHeight = state.BaseHeight;
        var isOcean = state.IsOcean;
        var waterZ = state.WaterZ;
        var volumeVoid = state.VolumeVoid;

        // Per-face surface Z: the nearest BP_Water plane to the face's own centroid whose Z lies within the
        // volume's box extent [minZ, boxTop] (the water is contained in the box, so a plane outside can't be its
        // surface, and the centroid — unlike the root origin, which is sometimes (0,0,0) — is always the real
        // water location). Falls back to the box top when none qualifies.
        var pairedCount = 0;
        double PairedSurfaceZ((double X, double Y)[] polygon, double minZ, double boxTopZ)
        {
            double centreX = 0, centreY = 0;
            foreach (var p in polygon)
            {
                centreX += p.X;
                centreY += p.Y;
            }

            centreX /= polygon.Length;
            centreY /= polygon.Length;

            var radiusSquared = SurfacePairRadiusCm * SurfacePairRadiusCm;
            double best = boxTopZ, bestDistance = double.MaxValue;
            var matched = false;
            foreach (var seed in seeds)
            {
                if (seed.Z < minZ || seed.Z > boxTopZ)
                {
                    continue;
                }

                var distance = (seed.X - centreX) * (seed.X - centreX) + (seed.Y - centreY) * (seed.Y - centreY);
                if (distance <= radiusSquared && distance < bestDistance)
                {
                    bestDistance = distance;
                    best = seed.Z;
                    matched = true;
                }
            }

            if (matched)
            {
                pairedCount++;
            }

            return best;
        }

        foreach (var (polygon, rawSurfaceZ, minZ) in volumes)
        {
            var surfaceZ = IsOceanBand(rawSurfaceZ) ? options.OceanZ : PairedSurfaceZ(polygon, minZ, rawSurfaceZ);

            if (traceIndex >= 0)
            {
                int tcol = traceIndex % width, trow = traceIndex / width;
                if (Polygons.Contains(polygon, frame.WorldXAtColumn(tcol), frame.WorldYAtRow(trow)))
                {
                    var tb = baseHeight[traceIndex];
                    var terrainZ = tb == 0 ? double.NaN : frame.HeightToZ(tb);
                    Console.WriteLine($"[water-trace] VOLUME face covers cell: box=[{minZ:F0}..{rawSurfaceZ:F0}] oceanBand={IsOceanBand(rawSurfaceZ)} pairedSurf={surfaceZ:F0} terrainZ={terrainZ:F0} floods={(tb != 0 && terrainZ <= surfaceZ)}");
                }
            }

            double minX = polygon.Min(p => p.X), maxX = polygon.Max(p => p.X), minY = polygon.Min(p => p.Y), maxY = polygon.Max(p => p.Y);
            int gx0 = Math.Max(0, (int)frame.FractionalColumn(minX)), gx1 = Math.Min(width - 1, (int)Math.Ceiling(frame.FractionalColumn(maxX)));
            int gy0 = Math.Max(0, (int)frame.FractionalRow(minY)), gy1 = Math.Min(height - 1, (int)Math.Ceiling(frame.FractionalRow(maxY)));

            for (var gy = gy0; gy <= gy1; gy++)
            {
                for (var gx = gx0; gx <= gx1; gx++)
                {
                    var index = gy * width + gx;
                    if (baseHeight[index] != 0)
                    {
                        var terrainZ = frame.HeightToZ(baseHeight[index]);
                        if (terrainZ > surfaceZ || terrainZ < minZ - VolumeFloorToleranceCm)
                        {
                            continue;
                        }
                    }

                    if (!Polygons.Contains(polygon, frame.WorldXAtColumn(gx), frame.WorldYAtRow(gy)))
                    {
                        continue;
                    }

                    if (baseHeight[index] == 0)
                    {
                        if (IsOceanBand(rawSurfaceZ))
                        {
                            volumeVoid[index] = true;
                        }

                        continue;
                    }

                    if (!isOcean[index] || surfaceZ > waterZ[index])
                    {
                        isOcean[index] = true;
                        waterZ[index] = surfaceZ;
                    }
                }
            }
        }

        Console.WriteLine($"  volume faces paired to a BP_Water surface plane: {pairedCount} (else box top; radius {SurfacePairRadiusCm / 100:F0}m)");
    }

    /// <summary>
    /// Clear the object flag on cells where a raised object (rock/coral/foliage) sits entirely below the water
    /// surface — a submerged spire under a higher water layer. Without this the object composites over the water
    /// and hides it (and the height-ranked "high water layer" the game shows here goes missing). Run after all
    /// water passes so the shader and the layer classification both treat these cells as water.
    /// </summary>
    public static void SinkSubmergedObjects(RenderState state, RenderOptions options)
    {
        var frame = state.Frame;
        var count = frame.Width * frame.Height;
        var heightGrid = state.Height;
        var waterZ = state.WaterZ;
        var isOcean = state.IsOcean;
        var isLake = state.IsLake;
        var objectKind = state.ObjectKind;
        var isRock = state.IsRock;
        long sunk = 0;

        for (var i = 0; i < count; i++)
        {
            if (objectKind[i] == 0 || !(isOcean[i] || isLake[i]))
            {
                continue;
            }

            var surface = waterZ[i] != 0 ? waterZ[i] : options.OceanZ;
            if (frame.HeightToZ(heightGrid[i]) < surface)
            {
                objectKind[i] = 0;
                isRock[i] = false;
                sunk++;
            }
        }

        Console.WriteLine($"submerged objects sunk (water renders over them): {sunk}");
    }

    /// <summary>Force void cells inside the far-west margin rectangles to ocean-blue.</summary>
    public static void ApplyBlueBoxes(RenderState state, RenderOptions options)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var baseHeight = state.BaseHeight;
        var volumeVoid = state.VolumeVoid;
        var boxes = options.BlueBoxes;
        var forced = 0;

        for (var gy = 0; gy < height; gy++)
        {
            for (var gx = 0; gx < width; gx++)
            {
                var index = gy * width + gx;
                if (baseHeight[index] != 0 || volumeVoid[index])
                {
                    continue;
                }

                double wx = frame.WorldXAtColumn(gx), wy = frame.WorldYAtRow(gy);
                if (boxes.Any(b => wx >= b.X0 && wx <= b.X1 && wy >= b.Y0 && wy <= b.Y1))
                {
                    volumeVoid[index] = true;
                    forced++;
                }
            }
        }

        if (forced > 0)
        {
            Console.WriteLine($"blue-box override: {forced} void cells forced ocean-blue.");
        }
    }

    /// <summary>Hermite-sample each BP_River segment and stamp a ribbon where terrain is at/below the surface.</summary>
    public static void StampRivers(RenderState state, IReadOnlyList<RiverActor> rivers, RenderOptions options, int traceIndex = -1)
    {
        var riverHalfWidth = options.RiverHalfWidthCm;
        var riverTolerance = options.RiverToleranceCm;
        Console.WriteLine($"river rasterise ({rivers.Count} BP_River actors, W={riverHalfWidth} tol={riverTolerance})...");

        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var heightGrid = state.Height;
        var isOcean = state.IsOcean;
        var isLake = state.IsLake;
        var isRiver = state.IsRiver;
        var waterZ = state.WaterZ;
        long marked = 0;

        foreach (var river in rivers)
        {
            double cos = Math.Cos(river.Yaw), sin = Math.Sin(river.Yaw);

            (double X, double Y, double Z) ToWorld(FVector p)
            {
                double lx = p.X * river.Scale.X, ly = p.Y * river.Scale.Y, lz = p.Z * river.Scale.Z;
                return (river.Location.X + lx * cos - ly * sin, river.Location.Y + lx * sin + ly * cos, river.Location.Z + lz);
            }

            foreach (var segment in river.Segments)
            {
                const int samples = 48;
                for (var i = 0; i <= samples; i++)
                {
                    double t = (double)i / samples, t2 = t * t, t3 = t2 * t;
                    double h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
                    var local = new FVector(
                        (float)(h00 * segment.StartPos.X + h10 * segment.StartTangent.X + h01 * segment.EndPos.X + h11 * segment.EndTangent.X),
                        (float)(h00 * segment.StartPos.Y + h10 * segment.StartTangent.Y + h01 * segment.EndPos.Y + h11 * segment.EndTangent.Y),
                        (float)(h00 * segment.StartPos.Z + h10 * segment.StartTangent.Z + h01 * segment.EndPos.Z + h11 * segment.EndTangent.Z));
                    var (wx, wy, wz) = ToWorld(local);
                    var half = riverHalfWidth * (segment.StartScale + (segment.EndScale - segment.StartScale) * t);

                    int gx0 = Math.Max(0, (int)frame.FractionalColumn(wx - half)), gx1 = Math.Min(width - 1, (int)Math.Ceiling(frame.FractionalColumn(wx + half)));
                    int gy0 = Math.Max(0, (int)frame.FractionalRow(wy - half)), gy1 = Math.Min(height - 1, (int)Math.Ceiling(frame.FractionalRow(wy + half)));
                    var halfSquared = half * half;

                    for (var gy = gy0; gy <= gy1; gy++)
                    {
                        for (var gx = gx0; gx <= gx1; gx++)
                        {
                            var j = gy * width + gx;

                            // Leave genuine ocean (ocean-band surface) alone; a river must not lower the sea.
                            if (isOcean[j] && IsOceanBand(waterZ[j]))
                            {
                                continue;
                            }

                            // Clip to the wet channel: skip banks whose terrain rises above the local river
                            // surface. Void cells (no seabed, e.g. a fall lip) still count as flowing water.
                            if (heightGrid[j] != 0 && frame.HeightToZ(heightGrid[j]) > wz + riverTolerance)
                            {
                                continue;
                            }

                            double dx = frame.WorldXAtColumn(gx) - wx, dy = frame.WorldYAtRow(gy) - wy;
                            if (dx * dx + dy * dy > halfSquared)
                            {
                                continue;
                            }

                            isOcean[j] = true;
                            isLake[j] = true;
                            isRiver[j] = true;
                            // The river carries the true terrain-following surface; lower any inflated volume
                            // surface (a tall waterfall box, or an upstream plane) to it so the channel reads
                            // shallow instead of tens of metres deep.
                            waterZ[j] = waterZ[j] == 0 ? wz : Math.Min(waterZ[j], wz);
                            marked++;
                            if (j == traceIndex)
                            {
                                Console.WriteLine($"[water-trace] RIVER writes surf={wz:F0}");
                            }
                        }
                    }
                }
            }
        }

        Console.WriteLine($"  rivers: marked={marked} cells");
    }

    /// <summary>Fill shallow BP_Water bodies (a scaled/rotated surface plane) where not already ocean.</summary>
    public static void FillShallowPonds(RenderState state, IReadOnlyList<WaterBodySeed> seeds, RenderOptions options, int traceIndex = -1)
    {
        Console.WriteLine($"shallow-water supplement ({seeds.Count} BP_Water bodies)...");
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var heightGrid = state.Height;
        var isOcean = state.IsOcean;
        var isLake = state.IsLake;
        var waterZ = state.WaterZ;
        long marked = 0, skippedOcean = 0, skippedHigh = 0;
        var debugged = 0;

        foreach (var seed in seeds)
        {
            double halfWidth = 50.0 * Math.Max(1, Math.Abs(seed.ScaleX)), halfDepth = 50.0 * Math.Max(1, Math.Abs(seed.ScaleY));
            if (debugged++ < 5)
            {
                Console.WriteLine($"   body ({seed.X:F0},{seed.Y:F0},{seed.Z:F0}) scale=({seed.ScaleX:F0},{seed.ScaleY:F0}) -> footprint {halfWidth * 2:F0}x{halfDepth * 2:F0} cm");
            }

            var yaw = seed.Yaw * Math.PI / 180.0;
            double cos = Math.Cos(-yaw), sin = Math.Sin(-yaw);
            var radius = Math.Max(halfWidth, halfDepth);
            int gx0 = Math.Max(0, (int)frame.FractionalColumn(seed.X - radius)), gx1 = Math.Min(width - 1, (int)frame.FractionalColumn(seed.X + radius));
            int gy0 = Math.Max(0, (int)frame.FractionalRow(seed.Y - radius)), gy1 = Math.Min(height - 1, (int)frame.FractionalRow(seed.Y + radius));

            for (var gy = gy0; gy <= gy1; gy++)
            {
                for (var gx = gx0; gx <= gx1; gx++)
                {
                    var j = gy * width + gx;
                    if (isOcean[j])
                    {
                        skippedOcean++;
                        continue;
                    }

                    if (heightGrid[j] == 0)
                    {
                        continue;
                    }

                    if (frame.HeightToZ(heightGrid[j]) > seed.Z)
                    {
                        skippedHigh++;
                        continue;
                    }

                    double dx = frame.WorldXAtColumn(gx) - seed.X, dy = frame.WorldYAtRow(gy) - seed.Y;
                    double rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
                    if (Math.Abs(rx) <= halfWidth && Math.Abs(ry) <= halfDepth)
                    {
                        isOcean[j] = true;
                        isLake[j] = true;
                        waterZ[j] = seed.Z;
                        marked++;
                        if (j == traceIndex)
                        {
                            Console.WriteLine($"[water-trace] POND writes surf={seed.Z:F0} (BP_Water at {seed.X:F0},{seed.Y:F0} scale {seed.ScaleX:F0}x{seed.ScaleY:F0})");
                        }
                    }
                }
            }
        }

        Console.WriteLine($"  supplement: marked={marked}  skipOcean={skippedOcean}  skipTerrainAboveSurface={skippedHigh}");
    }

    /// <summary>
    /// Seed from shallow WetSand/Puddles cells, then BFS-spread through connected shallow below-sea terrain
    /// (any material) within a depth cap — the coastal shelf the meshed landscape hides underwater.
    /// </summary>
    public static void FloodWetSand(RenderState state, RenderOptions options, int traceIndex = -1)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height, cellCount = width * height;
        var baseHeight = state.BaseHeight;
        var wetWeight = state.WetWeight;
        var isOcean = state.IsOcean;
        var isLake = state.IsLake;
        var waterZ = state.WaterZ;

        var threshold = options.WetThreshold;
        double wetSea = options.WetSeaZ, wetCut = wetSea + options.WetRiseCm, wetFloor = wetSea - options.WetDeepCm;

        bool IsShallowSubmerged(int i)
        {
            if (baseHeight[i] == 0)
            {
                return false;
            }

            var z = frame.HeightToZ(baseHeight[i]);
            return z < wetCut && z >= wetFloor;
        }

        var queue = new Queue<int>();
        for (var i = 0; i < cellCount; i++)
        {
            if (!isOcean[i] && wetWeight[i] >= threshold && IsShallowSubmerged(i))
            {
                isOcean[i] = true;
                isLake[i] = true;
                waterZ[i] = Math.Max(wetSea, frame.HeightToZ(baseHeight[i]));
                queue.Enqueue(i);
                if (i == traceIndex)
                {
                    Console.WriteLine($"[water-trace] WETSAND seed writes surf={waterZ[i]:F0}");
                }
            }
        }

        long seeded = queue.Count, flooded = queue.Count;
        while (queue.Count > 0)
        {
            var i = queue.Dequeue();
            int cx = i % width, cy = i / width;

            void Spread(int j)
            {
                if (!isOcean[j] && IsShallowSubmerged(j))
                {
                    isOcean[j] = true;
                    isLake[j] = true;
                    waterZ[j] = Math.Max(wetSea, frame.HeightToZ(baseHeight[j]));
                    queue.Enqueue(j);
                    flooded++;
                    if (j == traceIndex)
                    {
                        Console.WriteLine($"[water-trace] WETSAND spread writes surf={waterZ[j]:F0}");
                    }
                }
            }

            if (cx > 0)
            {
                Spread(i - 1);
            }

            if (cx < width - 1)
            {
                Spread(i + 1);
            }

            if (cy > 0)
            {
                Spread(i - width);
            }

            if (cy < height - 1)
            {
                Spread(i + width);
            }
        }

        Console.WriteLine($"submerged shallows: {seeded} wet seeds -> {flooded} cells (WetSand/Puddles>={threshold}, spread through shallow below-sea terrain)");
    }
}
