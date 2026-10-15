// Writes the render outputs to the working directory: map.ppm, optionally the surface and object
// rasters with map.layers, and the map-bounds.txt sidecar.

using System.Text;

using SfMapRenderer.Configuration;

namespace SfMapRenderer.Rendering;

/// <summary>
/// Writes the render outputs to the working directory: the flat composite <c>map.ppm</c>, optionally the
/// surface/object rasters and the per-cell class byte (<c>LAYERS</c>), and the <c>map-bounds.txt</c> sidecar.
/// </summary>
public static class MapWriter
{
    public static void Write(RenderState state, MapImages images, RenderOptions options, int maxSectionX, int maxSectionY)
    {
        var frame = state.Frame;
        int width = frame.Width, height = frame.Height;
        var compositePath = Path.Combine(Directory.GetCurrentDirectory(), "map.ppm");

        WritePpm("map.ppm", width, height, images.Composite);

        if (options.EmitLayers)
        {
            WritePpm("map.surf.ppm", width, height, images.Surface);
            WritePpm("map.obj.ppm", width, height, images.ObjectLayer);
            var layerBytes = BuildLayerBytes(state);
            File.WriteAllBytes(Path.Combine(Directory.GetCurrentDirectory(), "map.layers"), layerBytes);
            Console.WriteLine($"wrote map.surf.ppm + map.obj.ppm + map.layers ({layerBytes.Length} cells; trunk cells={state.TrunkMask.Count(t => t)})");
        }

        WriteBounds(frame, maxSectionX, maxSectionY, options.SeaLevelZ);
        Console.WriteLine($"wrote {compositePath} ({width}x{height})  seaLevelZ={options.SeaLevelZ}");
    }

    private static void WritePpm(string name, int width, int height, byte[] rgb)
    {
        using var stream = new FileStream(Path.Combine(Directory.GetCurrentDirectory(), name), FileMode.Create);
        var header = Encoding.ASCII.GetBytes($"P6\n{width} {height}\n255\n");
        stream.Write(header, 0, header.Length);
        stream.Write(rgb, 0, rgb.Length);
    }

    private static byte[] BuildLayerBytes(RenderState state)
    {
        var count = state.Frame.Width * state.Frame.Height;
        var baseHeight = state.BaseHeight;
        var isOcean = state.IsOcean;
        var isLake = state.IsLake;
        var volumeVoid = state.VolumeVoid;
        var objectKind = state.ObjectKind;
        var trunkMask = state.TrunkMask;

        var layers = new byte[count];
        for (var i = 0; i < count; i++)
        {
            var surface = CellClass.ResolveSurface(baseHeight[i] != 0, isOcean[i] || isLake[i], volumeVoid[i]);
            layers[i] = CellClass.Pack(surface, (ObjectKind)objectKind[i], trunkMask[i]);
        }

        return layers;
    }

    private static void WriteBounds(WorldFrame frame, int maxSectionX, int maxSectionY, double seaLevelZ)
    {
        var wx0 = WorldFrame.OriginX + frame.MinSectionX * WorldFrame.Scale;
        var wy0 = WorldFrame.OriginY + frame.MinSectionY * WorldFrame.Scale;
        var wx1 = WorldFrame.OriginX + (maxSectionX + 127) * WorldFrame.Scale;
        var wy1 = WorldFrame.OriginY + (maxSectionY + 127) * WorldFrame.Scale;
        File.WriteAllText(
            Path.Combine(Directory.GetCurrentDirectory(), "map-bounds.txt"),
            $"outW={frame.Width} outH={frame.Height} ds={frame.Downsample}\nworldCm X[{wx0}..{wx1}] Y[{wy0}..{wy1}]\nseaLevelZ={seaLevelZ}\n");
    }
}
