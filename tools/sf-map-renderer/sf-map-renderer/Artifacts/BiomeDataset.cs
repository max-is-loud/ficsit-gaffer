// Loads the canonical biome dataset (biomes.json) into Biome records: polygon rings in world
// centimetres, label cells, start indices, label colours and named sub-areas. Shared by the review
// overlay and the layered artifact.

using System.Text.Json;

namespace SfMapRenderer.Artifacts;

/// <summary>
/// A named area within a biome (Sentence Case, e.g. "The Great Canyon"), placed by an A1..AN34 grid cell —
/// rendered as a smaller label than the biome name (overlay-only; not used by biome resolution).
/// </summary>
public sealed record NamedArea(string Name, string? LabelCell);

/// <summary>
/// A named biome and its world-cm boundary rings. <paramref name="LabelCell"/> is an optional A1..AN34 grid
/// reference giving the exact cell for the name label (overlay-only; falls back to the ring centroid when
/// absent). <paramref name="SubLocations"/> are the named areas within it, and <paramref name="StartIndex"/>
/// (1..4), when present, marks a pioneer starting biome — the overlay appends a "(START n)" line to its name.
/// </summary>
public sealed record Biome(
    string Name,
    IReadOnlyList<(double X, double Y)[]> Polygons,
    string? LabelCell,
    IReadOnlyList<NamedArea> SubLocations,
    int? StartIndex,
    string? LabelColour)
{
    /// <summary>The on-map label: the biome name (as authored, honouring embedded line breaks) plus, for a
    /// starting biome, a "(START n)" line beneath it. The name itself never carries the START marker.</summary>
    public string DisplayLabel => StartIndex is { } index ? $"{Name}\n( START {index} )" : Name;
}

/// <summary>
/// Loads the canonical biome polygons from <c>packages/sf-game-data/data/biomes.json</c> (#239) — the
/// same dataset the overlay and layered-artifact renderers draw. Rings are world-cm <c>[x, y]</c> pairs.
/// </summary>
public static class BiomeDataset
{
    public static IReadOnlyList<Biome> Load(string path)
    {
        using var stream = File.OpenRead(path);
        using var document = JsonDocument.Parse(stream);

        var biomes = new List<Biome>();
        foreach (var biomeElement in document.RootElement.GetProperty("biomes").EnumerateArray())
        {
            var name = biomeElement.GetProperty("name").GetString() ?? "";
            var labelCell = biomeElement.TryGetProperty("labelCell", out var labelElement) ? labelElement.GetString() : null;
            int? startIndex = biomeElement.TryGetProperty("startIndex", out var startElement) && startElement.TryGetInt32(out var start) ? start : null;
            var labelColour = biomeElement.TryGetProperty("labelColor", out var colourElement) ? colourElement.GetString() : null;
            var polygons = new List<(double X, double Y)[]>();
            foreach (var polygonElement in biomeElement.GetProperty("polygons").EnumerateArray())
            {
                var ring = new List<(double X, double Y)>();
                foreach (var pointElement in polygonElement.EnumerateArray())
                {
                    ring.Add((pointElement[0].GetDouble(), pointElement[1].GetDouble()));
                }

                polygons.Add([.. ring]);
            }

            var subLocations = new List<NamedArea>();
            if (biomeElement.TryGetProperty("subLocations", out var subLocationsElement))
            {
                foreach (var subLocationElement in subLocationsElement.EnumerateArray())
                {
                    var subName = subLocationElement.GetProperty("name").GetString() ?? "";
                    var subCell = subLocationElement.TryGetProperty("labelCell", out var subCellElement) ? subCellElement.GetString() : null;
                    subLocations.Add(new NamedArea(subName, subCell));
                }
            }

            biomes.Add(new Biome(name, polygons, labelCell, subLocations, startIndex, labelColour));
        }

        return biomes;
    }
}
