// Fallback terrain colours chosen by keyword in a landscape layer name, used when the real material
// colour cannot be sampled.

namespace SfMapRenderer.Landscape;

/// <summary>Approximate real-world terrain colours for landscape material layers, keyed by layer name.</summary>
public static class TerrainPalette
{
    public static (byte R, byte G, byte B) ColourFor(string layerName)
    {
        if (Has(layerName, "sand", "dune", "desert", "beach"))
        {
            return (206, 178, 126);
        }

        if (Has(layerName, "forest", "jungle", "tree"))
        {
            return (58, 84, 48);
        }

        if (Has(layerName, "grass", "moss", "field", "meadow"))
        {
            return (104, 132, 70);
        }

        if (Has(layerName, "snow", "ice"))
        {
            return (232, 236, 240);
        }

        if (Has(layerName, "coral"))
        {
            return (178, 168, 142);
        }

        if (Has(layerName, "rock", "stone", "cliff", "gravel", "mountain", "scree"))
        {
            return (140, 132, 120);
        }

        if (Has(layerName, "soil", "dirt", "mud", "ground"))
        {
            return (112, 90, 62);
        }

        return (120, 128, 96);
    }

    private static bool Has(string name, params string[] keywords)
    {
        foreach (var keyword in keywords)
        {
            if (name.Contains(keyword, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
