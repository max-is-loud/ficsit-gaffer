// Standalone survey: lists the instanced-foliage placements nearest a coordinate, resolving the
// custom FGFoliageInstancedSMC cell-offset transform, to identify the species at a spot.

using CUE4Parse.UE4.Assets.Exports.Component.StaticMesh;

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>
/// Lists the instanced-foliage placements nearest a coordinate, resolving Satisfactory's custom
/// <c>FGFoliageInstancedSMC</c> with its cell-offset transform (see base-map-foliage-decode.md) — so we can
/// identify the actual species mesh at a spot and sanity-check foliage placement.
/// </summary>
public static class TreeAtProbe
{
    public static void Report(GameAssetProvider assets, double targetX, double targetY, double radius)
    {
        var hits = new List<(double Distance, string Text, bool Foliage)>();
        var packages = assets.GeneratedCellPackages().Concat(assets.AllGameLevelPackages()).Distinct();
        foreach (var cell in packages)
        {
            try
            {
                foreach (var export in assets.Provider.LoadPackage(cell).GetExports())
                {
                    var type = export.ExportType;
                    if (!type.Contains("StaticMeshComponent", StringComparison.Ordinal)
                        && !type.Contains("InstancedSMC", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var path = export.MeshIndex()?.ResolvedObject?.GetPathName()
                        ?? export.GetOrDefault<FPackageIndex?>("StaticMesh")?.ResolvedObject?.GetPathName()
                        ?? "(no mesh)";

                    // FGFoliageInstancedSMC isn't cast to UInstancedStaticMeshComponent by name — read the raw buffer.
                    var instances = (export as UInstancedStaticMeshComponent)?.PerInstanceSMData
                        ?? export.GetOrDefault<FInstancedStaticMeshInstanceData[]?>("PerInstanceSMData");

                    var isFoliage = type == "FGFoliageInstancedSMC";
                    if (instances is { Length: > 0 })
                    {
                        // Stock foliage: translations are relative to TranslatedInstanceSpaceOrigin. FGFoliage:
                        // translations are relative to the owning InstancedFoliageActor's cell — the offset lives on
                        // the actor RootComponent (this component's AttachParent), not TranslatedInstanceSpaceOrigin.
                        var offset = export.GetOrDefault<FVector>("TranslatedInstanceSpaceOrigin");
                        if (isFoliage)
                        {
                            var attach = export.GetOrDefault<UObject?>("AttachParent");
                            offset = attach is { } a && a.HasRelativeLocation() ? a.RelativeLocation() : new FVector(0, 0, 0);
                        }

                        foreach (var instance in instances)
                        {
                            var t = instance.TransformData;
                            double wx = offset.X + t.Translation.X, wy = offset.Y + t.Translation.Y, wz = offset.Z + t.Translation.Z;
                            var d = Math.Sqrt((wx - targetX) * (wx - targetX) + (wy - targetY) * (wy - targetY));
                            if (d <= radius)
                            {
                                hits.Add((d, $"{d / 100,6:F1}m  {type,-28} {path}  @({wx:F0},{wy:F0},{wz:F0}) scale=({t.Scale3D.X:F2},{t.Scale3D.Y:F2},{t.Scale3D.Z:F2})", isFoliage));
                            }
                        }
                    }
                    else if (export.HasRelativeLocation())
                    {
                        var loc = export.RelativeLocation();
                        var d = Math.Sqrt((loc.X - targetX) * (loc.X - targetX) + (loc.Y - targetY) * (loc.Y - targetY));
                        if (d <= radius)
                        {
                            var s = export.RelativeScale();
                            hits.Add((d, $"{d / 100,6:F1}m  {type,-28} {path}  @({loc.X:F0},{loc.Y:F0},{loc.Z:F0}) scale=({s.X:F2},{s.Y:F2},{s.Z:F2})", false));
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[skip] {cell}: {ex.Message}");
            }
        }

        Console.WriteLine("\n--- nearest of ANY type ---");
        foreach (var (_, text, _) in hits.OrderBy(h => h.Distance).Take(15))
        {
            Console.WriteLine("  " + text);
        }

        Console.WriteLine("\n--- nearest FGFoliageInstancedSMC ---");
        foreach (var (_, text, _) in hits.Where(h => h.Foliage).OrderBy(h => h.Distance).Take(10))
        {
            Console.WriteLine("  " + text);
        }

        Console.WriteLine($"\nDONE ({hits.Count} instances within {radius / 100:F0}m)");
    }
}
