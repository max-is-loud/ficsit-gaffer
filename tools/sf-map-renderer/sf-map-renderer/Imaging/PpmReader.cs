// Reads the binary P6 PPM rasters the renderer writes, since ImageSharp has no Netpbm codec.

using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace SfMapRenderer.Imaging;

/// <summary>Reads the binary P6 PPM rasters the renderer writes (ImageSharp has no Netpbm codec).</summary>
public static class PpmReader
{
    public static Image<Rgb24> Load(string path)
    {
        var (width, height, pixels) = Read(path);
        return Image.LoadPixelData<Rgb24>(pixels, width, height);
    }

    public static (int Width, int Height, byte[] Pixels) Read(string path)
    {
        var bytes = File.ReadAllBytes(path);
        var offset = 0;

        if (ReadToken(bytes, ref offset) != "P6")
        {
            throw new InvalidDataException($"{path} is not a binary P6 PPM.");
        }

        var width = int.Parse(ReadToken(bytes, ref offset), System.Globalization.CultureInfo.InvariantCulture);
        var height = int.Parse(ReadToken(bytes, ref offset), System.Globalization.CultureInfo.InvariantCulture);
        _ = ReadToken(bytes, ref offset); // max value (255)
        offset++; // the single whitespace byte before the pixel block

        var pixelCount = width * height * 3;
        var pixels = new byte[pixelCount];
        Array.Copy(bytes, offset, pixels, 0, pixelCount);
        return (width, height, pixels);
    }

    private static string ReadToken(byte[] bytes, ref int offset)
    {
        while (offset < bytes.Length && char.IsWhiteSpace((char)bytes[offset]))
        {
            offset++;
        }

        var start = offset;
        while (offset < bytes.Length && !char.IsWhiteSpace((char)bytes[offset]))
        {
            offset++;
        }

        return System.Text.Encoding.ASCII.GetString(bytes, start, offset - start);
    }
}
