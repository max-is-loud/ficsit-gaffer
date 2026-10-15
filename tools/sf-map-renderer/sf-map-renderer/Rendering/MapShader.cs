// Turns the render state into colour: the hillshaded surface raster, the object raster, and the
// composite with objects drawn over the ground.

using SfMapRenderer.Configuration;

namespace SfMapRenderer.Rendering;

/// <summary>The three colour rasters a render produces.</summary>
public sealed record MapImages(byte[] Surface, byte[] ObjectLayer, byte[] Composite);

/// <summary>
/// Colours the map. The <em>surface</em> raster (land/water/void, hillshaded on the bare landscape) is
/// computed for every cell, and the <em>object</em> raster (rock/coral/foliage, hillshaded on the object
/// height) only where an object is topmost — so a layer can reveal the ground beneath. The flat composite
/// is the surface with the object drawn over it.
/// </summary>
public static class MapShader
{
    public static MapImages Render(RenderState state, RenderOptions options)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var baseHeight = state.BaseHeight;
        var heightGrid = state.Height;
        var terrain = state.Terrain;
        var isOcean = state.IsOcean;
        var isLake = state.IsLake;
        var waterZ = state.WaterZ;
        var volumeVoid = state.VolumeVoid;
        var isRiver = state.IsRiver;
        var objectKind = state.ObjectKind;
        var objectColour = state.ObjectColour;

        double lightX = -0.7071, lightY = -0.7071, lightZ = 1.0;
        var length = Math.Sqrt(lightX * lightX + lightY * lightY + lightZ * lightZ);
        lightX /= length;
        lightY /= length;
        lightZ /= length;
        var cellCm = frame.CellWidthCm;

        var surface = new byte[width * height * 3];
        var objectRaster = new byte[width * height * 3];
        var composite = new byte[width * height * 3];

        // NW-lit hillshade of height array `h` at cell (x,y). Void neighbours fall back to the centre height.
        double Shade(float[] h, int x, int y, int idx)
        {
            var centre = h[idx];
            var left = x > 0 ? h[idx - 1] : centre;
            var right = x < width - 1 ? h[idx + 1] : centre;
            var top = y > 0 ? h[idx - width] : centre;
            var bottom = y < height - 1 ? h[idx + width] : centre;
            if (left == 0)
            {
                left = centre;
            }

            if (right == 0)
            {
                right = centre;
            }

            if (top == 0)
            {
                top = centre;
            }

            if (bottom == 0)
            {
                bottom = centre;
            }

            var dzdx = (frame.HeightToZ(right) - frame.HeightToZ(left)) / (2 * cellCm);
            var dzdy = (frame.HeightToZ(bottom) - frame.HeightToZ(top)) / (2 * cellCm);
            double nx = -dzdx, ny = -dzdy, nz = 1.0;
            var normalLength = Math.Sqrt(nx * nx + ny * ny + nz * nz);
            return 0.45 + 0.55 * Math.Clamp((nx * lightX + ny * lightY + nz * lightZ) / normalLength, 0, 1);
        }

        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var idx = y * width + x;
                var cell = idx * 3;
                var landHeight = baseHeight[idx];
                var isWater = isOcean[idx] || isLake[idx];
                var waterSurface = isWater ? (waterZ[idx] != 0 ? waterZ[idx] : options.OceanZ) : 0.0;
                double r, g, b;

                if (landHeight == 0 && !isWater)
                {
                    (r, g, b) = volumeVoid[idx] ? (22, 55, 110) : (46, 49, 55);
                }
                else if (isWater)
                {
                    // Floor is the raised solid top (terrain or a submerged rock), so shallow water over a
                    // submerged spire reads shallow rather than deep. Void seabed falls back to a deep floor.
                    var floorZ = landHeight == 0 ? waterSurface - 8000 : frame.HeightToZ(heightGrid[idx]);
                    // Flowing water (river/waterfall channel) is a thin sheet following the terrain — render it
                    // shallow (light) regardless of how far the slope or a void seabed drops below the surface.
                    if (isRiver[idx])
                    {
                        floorZ = waterSurface - 200;
                    }
                    // A square-root ramp over ~40 m gives shallow inland lakes/rivers a visible depth gradient
                    // (the old linear /7000 ramp mapped their 0–5 m to ~0, so every lake read the same pale blue),
                    // while deep ocean still saturates to the darkest tone.
                    var depth = Math.Clamp(Math.Sqrt(Math.Max(0, waterSurface - floorZ) / 4000.0), 0, 1);
                    // Inland water gets a darker deep end for more depth contrast; the ocean (and the blue-box
                    // deep-sea margin it must match) keeps its original ramp, whose deep tone ≈ the (22,55,110)
                    // volume-void override.
                    var oceanBand = waterSurface is >= -1850 and <= -1600;
                    if (oceanBand)
                    {
                        r = 22 + 40 * (1 - depth);
                        g = 52 + 70 * (1 - depth);
                        b = 104 + 74 * (1 - depth);
                    }
                    else
                    {
                        r = 8 + 62 * (1 - depth);
                        g = 28 + 108 * (1 - depth);
                        b = 72 + 118 * (1 - depth);
                    }
                }
                else
                {
                    var shade = Shade(baseHeight, x, y, idx);
                    double baseR, baseG, baseB;
                    if (terrain[cell] != 0 || terrain[cell + 1] != 0 || terrain[cell + 2] != 0)
                    {
                        baseR = terrain[cell];
                        baseG = terrain[cell + 1];
                        baseB = terrain[cell + 2];
                    }
                    else
                    {
                        var elevation = Math.Clamp((frame.HeightToZ(landHeight) - options.SeaLevelZ) / 40000.0, 0, 1);
                        baseR = 90 + 130 * elevation;
                        baseG = 120 + 100 * elevation;
                        baseB = 70 + 120 * elevation;
                    }

                    r = baseR * shade;
                    g = baseG * shade;
                    b = baseB * shade;
                }

                surface[cell] = (byte)Math.Clamp(r, 0, 255);
                surface[cell + 1] = (byte)Math.Clamp(g, 0, 255);
                surface[cell + 2] = (byte)Math.Clamp(b, 0, 255);
                composite[cell] = surface[cell];
                composite[cell + 1] = surface[cell + 1];
                composite[cell + 2] = surface[cell + 2];

                if (objectKind[idx] != 0)
                {
                    var shade = Shade(heightGrid, x, y, idx);
                    // The per-family base colour written by the rasteriser; fall back to the kind palette if unset.
                    (double baseR, double baseG, double baseB) =
                        objectColour[cell] != 0 || objectColour[cell + 1] != 0 || objectColour[cell + 2] != 0
                            ? (objectColour[cell], objectColour[cell + 1], objectColour[cell + 2])
                            : objectKind[idx] switch
                            {
                                2 => (152, 100, 170), // coral (purple)
                                3 => (70, 120, 74),   // tree foliage
                                _ => (143, 135, 122), // rock
                            };
                    objectRaster[cell] = (byte)Math.Clamp(baseR * shade, 0, 255);
                    objectRaster[cell + 1] = (byte)Math.Clamp(baseG * shade, 0, 255);
                    objectRaster[cell + 2] = (byte)Math.Clamp(baseB * shade, 0, 255);
                    composite[cell] = objectRaster[cell];
                    composite[cell + 1] = objectRaster[cell + 1];
                    composite[cell + 2] = objectRaster[cell + 2];
                }
            }
        }

        if (options.EastFade is not null || options.CapturedFade is not null)
        {
            EastCoastFade(surface, composite, state, width, height, options);
        }

        return new MapImages(surface, objectRaster, composite);
    }

    /// <summary>
    /// Within one region (the coast east of the swamp + dune desert), softens the hard line where the shallow
    /// coastal water meets the flat deep-sea void: recolours the void cells there by their distance to the coast
    /// so the sea deepens smoothly from the shore to deep ocean blue, extending east. Only void cells are touched
    /// (captured ocean and the void's extent are unchanged); the region edge is feathered and low-frequency noise
    /// keeps it from reading as a uniform bubble. North/south voids are outside the region and untouched.
    /// </summary>
    private static void EastCoastFade(byte[] surface, byte[] composite, RenderState state, int width, int height, RenderOptions options)
    {
        var frame = state.Frame;
        var heightGrid = state.Height;
        var volumeVoid = state.VolumeVoid;
        var objectKind = state.ObjectKind;
        var count = width * height;

        // Chamfer distance-to-coast (0 at solid land, near-Euclidean), so the gradient follows the coastline.
        const float Infinity = 1e9f, Ortho = 1f, Diag = 1.41421356f;
        var dist = new float[count];
        for (var i = 0; i < count; i++)
        {
            dist[i] = heightGrid[i] != 0 && !state.IsOcean[i] && !state.IsLake[i] && !volumeVoid[i] && !state.OceanVoid[i] ? 0f : Infinity;
        }

        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var i = y * width + x;
                var d = dist[i];
                if (x > 0) { d = Math.Min(d, dist[i - 1] + Ortho); }
                if (y > 0) { d = Math.Min(d, dist[i - width] + Ortho); }
                if (x > 0 && y > 0) { d = Math.Min(d, dist[i - width - 1] + Diag); }
                if (x < width - 1 && y > 0) { d = Math.Min(d, dist[i - width + 1] + Diag); }
                dist[i] = d;
            }
        }

        for (var y = height - 1; y >= 0; y--)
        {
            for (var x = width - 1; x >= 0; x--)
            {
                var i = y * width + x;
                var d = dist[i];
                if (x < width - 1) { d = Math.Min(d, dist[i + 1] + Ortho); }
                if (y < height - 1) { d = Math.Min(d, dist[i + width] + Ortho); }
                if (x < width - 1 && y < height - 1) { d = Math.Min(d, dist[i + width + 1] + Diag); }
                if (x > 0 && y < height - 1) { d = Math.Min(d, dist[i + width - 1] + Diag); }
                dist[i] = d;
            }
        }

        var cellCm = frame.CellWidthCm;
        var rampCm = options.EastFadeDistanceCm;
        var feather = options.EastFadeFeatherCm;
        var eastFade = options.EastFade;
        var capturedFade = options.CapturedFade;
        for (var i = 0; i < count; i++)
        {
            if (objectKind[i] != 0)
            {
                continue;
            }

            double wx = frame.WorldXAtColumn(i % width), wy = frame.WorldYAtRow(i / width);
            double weight;
            if (heightGrid[i] == 0 && volumeVoid[i])
            {
                weight = eastFade is { } ef ? EdgeWeight(ef, wx, wy, feather) : 0; // deep-sea void
            }
            else if (heightGrid[i] != 0 && state.IsOcean[i] && !state.IsRiver[i] && state.WaterZ[i] is >= -1850 and <= -1600)
            {
                weight = capturedFade is { } cf ? EdgeWeight(cf, wx, wy, feather) : 0; // captured seabed (SE only)
            }
            else
            {
                continue;
            }

            if (weight <= 0)
            {
                continue;
            }

            var noise = (SeaNoise(wx, wy, options.EastFadeNoiseWavelengthCm) - 0.5) * 2.0 * options.EastFadeNoise;
            var shore = 1 - Math.Clamp(dist[i] * cellCm / rampCm + noise, 0, 1);
            double r = 22 + 40 * shore, g = 52 + 70 * shore, b = 104 + 74 * shore;
            var c = i * 3;
            surface[c] = (byte)(surface[c] * (1 - weight) + r * weight);
            surface[c + 1] = (byte)(surface[c + 1] * (1 - weight) + g * weight);
            surface[c + 2] = (byte)(surface[c + 2] * (1 - weight) + b * weight);
            composite[c] = surface[c];
            composite[c + 1] = surface[c + 1];
            composite[c + 2] = surface[c + 2];
        }
    }

    /// <summary>Feathered membership of one rectangle: 1 inside, smoothstep to 0 across <paramref name="feather"/>.</summary>
    private static double EdgeWeight(WorldRect r, double wx, double wy, double feather)
    {
        var dx = Math.Max(r.X0 - wx, wx - r.X1);
        var dy = Math.Max(r.Y0 - wy, wy - r.Y1);
        var signed = dx <= 0 && dy <= 0 ? Math.Max(dx, dy) : Math.Sqrt(Math.Max(dx, 0) * Math.Max(dx, 0) + Math.Max(dy, 0) * Math.Max(dy, 0));
        if (feather <= 0)
        {
            return signed <= 0 ? 1.0 : 0.0;
        }

        var t = Math.Clamp((feather - signed) / (2 * feather), 0, 1);
        return t * t * (3 - 2 * t);
    }

    // Smooth two-octave value noise in [0,1] from a world position (deterministic; no libraries).
    private static double SeaNoise(double wx, double wy, double wavelength) =>
        0.65 * ValueNoise(wx / wavelength, wy / wavelength) + 0.35 * ValueNoise(wx / (wavelength * 0.5), wy / (wavelength * 0.5));

    private static double ValueNoise(double fx, double fy)
    {
        int x0 = (int)Math.Floor(fx), y0 = (int)Math.Floor(fy);
        double tx = fx - x0, ty = fy - y0;
        double sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        double a = Lattice(x0, y0) + (Lattice(x0 + 1, y0) - Lattice(x0, y0)) * sx;
        double bb = Lattice(x0, y0 + 1) + (Lattice(x0 + 1, y0 + 1) - Lattice(x0, y0 + 1)) * sx;
        return a + (bb - a) * sy;
    }

    private static double Lattice(int x, int y)
    {
        var h = (uint)(x * 374761393 + y * 668265263);
        h = (h ^ (h >> 13)) * 1274126177u;
        return ((h ^ (h >> 16)) & 0xFFFFFF) / (double)0x1000000;
    }
}
