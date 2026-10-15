// Placeholder base colours for placed trees, coral and rock, chosen by family from the mesh asset
// path, used when no sampled material colour is available.

using SfMapRenderer.Collection;

namespace SfMapRenderer.Rendering;

/// <summary>
/// Per-family base colours for placed meshes, chosen from the mesh asset path — so tree species, coral
/// species and rock types read distinctly instead of one flat colour each. These are curated placeholders;
/// sampling the real material/texture is the eventual upgrade. The hillshade is applied by the shader.
/// </summary>
public static class ObjectPalette
{
    // Matched by an ordered substring on the asset path (the family folder); first hit wins, else the default.
    private static readonly (string Folder, byte R, byte G, byte B)[] Trees =
    [
        ("/AmberTree", 176, 126, 52),      // amber/orange canopy
        ("/PurpleTree", 128, 92, 150),     // purple
        ("/Bamboo", 156, 170, 92),         // yellow-green
        ("/DeadSwampTree", 120, 108, 80),  // bare/brown
        ("/BluePalm", 92, 150, 120),       // blue-green palm
        ("/DypsisPalm", 100, 152, 112),
        ("/Kapok", 60, 110, 55),           // deep jungle green
        ("/DioTree", 82, 126, 72),
        ("/GreenTree", 70, 120, 72),
        ("/SnakeLegs", 84, 124, 80),
        ("/SnailBottomTree", 96, 132, 84),
        ("/HuegelainenTree", 104, 144, 100),
        ("/TitanTree", 70, 120, 74),
    ];

    private static readonly (string Folder, byte R, byte G, byte B)[] Rocks =
    [
        ("/DesertRock", 190, 152, 124),        // light sandstone, tracks the desert sand colour
        ("/DestructibleRock", 156, 124, 102),
        ("/SmoothRock", 152, 144, 130),
        ("/Rubble", 150, 140, 124),
        ("/Boulder", 138, 130, 118),
        ("/Arc", 142, 134, 122),
        ("/Cliff", 140, 132, 120),             // grey cliff
    ];

    private static readonly (byte R, byte G, byte B) DefaultTree = (70, 120, 74);
    // In-game the alien coral (trees + shells) glows a magenta/purple from its emissive — the base-texture
    // albedo samples green/brown and misses that, so all coral renders as one fixed purple-ish hue instead.
    private static readonly (byte R, byte G, byte B) DefaultCoral = (152, 100, 170);
    private static readonly (byte R, byte G, byte B) DefaultRock = (143, 135, 122);

    public static (byte R, byte G, byte B) ColourFor(string path, PlacedMeshKind kind) => kind switch
    {
        PlacedMeshKind.Tree => Match(path, Trees, DefaultTree),
        PlacedMeshKind.Coral => DefaultCoral, // all coral one purple hue, ignoring albedo + per-species table

        _ => Match(path, Rocks, DefaultRock),
    };

    private static (byte R, byte G, byte B) Match(string path, (string Folder, byte R, byte G, byte B)[] table, (byte R, byte G, byte B) fallback)
    {
        foreach (var (folder, r, g, b) in table)
        {
            if (path.Contains(folder, StringComparison.OrdinalIgnoreCase))
            {
                return (r, g, b);
            }
        }

        return fallback;
    }
}
