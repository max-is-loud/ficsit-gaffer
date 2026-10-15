// Classifies a tree mesh's material sections as foliage or trunk by material name, so trunks and
// canopy can render as separate layers.

namespace SfMapRenderer.Flora;

/// <summary>
/// Classifies a tree mesh's material sections as foliage (leaves/branches/canopy) versus trunk/bark.
/// A tree is one static mesh with separate material sections, so this split is what lets the trunk and
/// the canopy render as independent layers.
/// </summary>
public static class TreeSectionClassifier
{
    private static readonly string[] FoliageKeywords =
        ["leaf", "branch", "liana", "ivy", "frond", "mushroom", "canopy", "foliage", "moss"];

    /// <summary>
    /// True if a section's material name denotes foliage. The name must be the material <em>basename</em>,
    /// not a full asset path — otherwise the <c>/Foliage/</c> folder segment would match everything.
    /// </summary>
    public static bool IsFoliageMaterial(string materialName)
    {
        foreach (var keyword in FoliageKeywords)
        {
            if (materialName.Contains(keyword, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
