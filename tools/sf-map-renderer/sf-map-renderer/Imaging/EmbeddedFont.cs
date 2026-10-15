// Loads the embedded Lato Regular font for overlay labels, and exposes its raw bytes for embedding
// in the HTML artifact.

using SixLabors.Fonts;

namespace SfMapRenderer.Imaging;

/// <summary>The embedded Lato Regular face, used for the overlay and layered-artifact labels.</summary>
public static class EmbeddedFont
{
    private static readonly FontFamily Family = Load();

    public static Font At(float size) => Family.CreateFont(size, FontStyle.Regular);

    /// <summary>The raw Lato Regular TTF, e.g. to embed as a base64 <c>@font-face</c> in the HTML artifact.</summary>
    public static byte[] RegularTtfBytes()
    {
        var assembly = typeof(EmbeddedFont).Assembly;
        var resource = assembly.GetManifestResourceNames().First(n => n.EndsWith("Lato-Regular.ttf", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(resource)!;
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }

    private static FontFamily Load()
    {
        using var stream = new MemoryStream(RegularTtfBytes());
        return new FontCollection().Add(stream, System.Globalization.CultureInfo.InvariantCulture);
    }
}
