// Standalone survey: reads the baked landscape grass density for the component covering a
// coordinate, per grass type, to show where grass grows even when the weightmap is sand.

using CUE4Parse.UE4.Assets.Exports.Component.Landscape;

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Reads the baked Landscape Grass density (FLandscapeComponentGrassData) for the component covering a coordinate:
/// per grass type (Grass, Forest, Sand, …) the average + at-point density baked into the cooked landscape. This is
/// the game's actual runtime-grass spawn, so it tells us where green grass grows even when the weightmap is Sand.
/// </summary>
public static class GrassDataProbe
{
    public static void Report(GameAssetProvider assets, double worldX, double worldY)
    {
        // world -> landscape vertex (worldX = -50800 + SectionBaseX*100, scale 100).
        var vx = (int)Math.Round((worldX + 50800) / 100.0);
        var vy = (int)Math.Round((worldY + 50800) / 100.0);
        Console.WriteLine($"target world ({worldX},{worldY}) -> vertex ({vx},{vy})");

        foreach (var cell in assets.GeneratedCellPackages())
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(cell).GetExports())
                {
                    if (export is not ULandscapeComponent lc)
                    {
                        continue;
                    }

                    var stride = lc.SubsectionSizeQuads * lc.NumSubsections + 1;
                    if (vx < lc.SectionBaseX || vx > lc.SectionBaseX + lc.ComponentSizeQuads
                        || vy < lc.SectionBaseY || vy > lc.SectionBaseY + lc.ComponentSizeQuads)
                    {
                        continue;
                    }

                    var grass = lc.GrassData;
                    if (grass?.WeightOffsets == null)
                    {
                        Console.WriteLine($"component base ({lc.SectionBaseX},{lc.SectionBaseY}): no grass data");
                        return;
                    }

                    var num = grass.NumElements;
                    var localIndex = (vy - lc.SectionBaseY) * stride + (vx - lc.SectionBaseX);
                    Console.WriteLine($"component base ({lc.SectionBaseX},{lc.SectionBaseY}) stride={stride} NumElements={num} HeightWeightData={grass.HeightWeightData?.Length}  localVertex={localIndex}");
                    Console.WriteLine("  grass type                     offset   avg   max   @point");
                    foreach (var (typeIndex, offset) in grass.WeightOffsets.OrderBy(k => k.Value))
                    {
                        var name = typeIndex.ResolvedObject?.Name.Text ?? typeIndex.ResolvedObject?.GetPathName() ?? "?";
                        long sum = 0; byte max = 0; var data = grass.HeightWeightData;
                        for (var i = 0; i < num && offset + i < data!.Length; i++)
                        {
                            var d = data[offset + i];
                            sum += d;
                            if (d > max) max = d;
                        }

                        var atPoint = data != null && offset + localIndex < data.Length && localIndex >= 0 ? data[offset + localIndex] : (byte)0;
                        Console.WriteLine($"  {name,-30} {offset,7} {sum / Math.Max(1, num),5} {max,5} {atPoint,7}");
                    }

                    // Correlate dominant grass type with height: is the green grass on the high ground (tops) or low?
                    var offsets = grass.WeightOffsets.OrderBy(k => k.Value)
                        .Select(k => (Name: k.Key.ResolvedObject?.Name.Text ?? "?", Off: k.Value)).ToArray();
                    var hw = grass.HeightWeightData!;
                    var byDom = new Dictionary<string, (long HSum, int Count)>();
                    for (var i = 0; i < num; i++)
                    {
                        var height = (ushort)(hw[i * 2] | (hw[i * 2 + 1] << 8));
                        string dom = "none"; byte best = 0;
                        foreach (var (nm, off) in offsets)
                        {
                            var d = off + i < hw.Length ? hw[off + i] : (byte)0;
                            if (d > best) { best = d; dom = nm; }
                        }

                        var cur = byDom.GetValueOrDefault(dom);
                        byDom[dom] = (cur.HSum + height, cur.Count + 1);
                    }

                    Console.WriteLine("\n  dominant grass type -> vertex count + avg height16 (higher = taller ground):");
                    foreach (var (nm, v) in byDom.OrderByDescending(p => p.Value.Count))
                    {
                        Console.WriteLine($"    {nm,-16} count={v.Count,6}  avgHeight16={v.HSum / Math.Max(1, v.Count)}");
                    }

                    Console.WriteLine("\nDONE");
                    return;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[skip] {cell}: {ex.Message}");
            }
        }

        Console.WriteLine("\nDONE (no landscape component found for that coord)");
    }
}
