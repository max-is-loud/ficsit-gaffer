// Standalone survey: dumps the structure of the first BP_River actor (root, spline and spline-mesh
// parameters).

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>Dumps the structure of the first BP_River actor (root, spline, spline-mesh params) (was MODE=riverdump).</summary>
public static class RiverDumpProbe
{
    public static void Report(GameAssetProvider assets)
    {
        foreach (var package in assets.AllGameLevelPackages())
        {
            try
            {
                var loaded = assets.Provider.LoadPackage(package);
                if (!loaded.GetExports().Any(e => e.Name.StartsWith("BP_River_PROT", StringComparison.Ordinal)))
                {
                    continue;
                }

                Console.WriteLine($"PKG {package}");
                var actor = loaded.GetExports().First(e => e.Name.StartsWith("BP_River_PROT", StringComparison.Ordinal));

                var root = actor.GetOrDefault<UObject?>("RootComponent");
                if (root != null)
                {
                    var location = root.GetOrDefault<FVector>("RelativeLocation", new FVector(0, 0, 0));
                    var rotation = root.GetOrDefault<FRotator>("RelativeRotation", new FRotator(0, 0, 0));
                    var scale = root.GetOrDefault<FVector>("RelativeScale3D", new FVector(1, 1, 1));
                    Console.WriteLine($"  ROOT [{root.ExportType}] {root.Name} loc=({location.X:F0},{location.Y:F0},{location.Z:F0}) rot=(p{rotation.Pitch:F0},y{rotation.Yaw:F0},r{rotation.Roll:F0}) scl=({scale.X:F2},{scale.Y:F2},{scale.Z:F2})");
                    Console.WriteLine($"       rootprops: {string.Join(",", root.Properties.Select(p => p.Name.Text))}");
                }

                var spline = actor.GetOrDefault<UObject?>("mSplineComponent");
                if (spline != null)
                {
                    Console.WriteLine($"  SPLINE [{spline.ExportType}] {spline.Name} props: {string.Join(",", spline.Properties.Select(p => p.Name.Text))}");
                    var splineLocation = spline.GetOrDefault<FVector>("RelativeLocation", new FVector(0, 0, 0));
                    Console.WriteLine($"       splineloc=({splineLocation.X:F0},{splineLocation.Y:F0},{splineLocation.Z:F0})");
                    var curves = spline.Properties.FirstOrDefault(p => p.Name.Text == "SplineCurves");
                    if (curves != null)
                    {
                        var curveStruct = curves.Tag?.GenericValue as FStructFallback;
                        var position = curveStruct?.Properties.FirstOrDefault(p => p.Name.Text == "Position")?.Tag?.GenericValue as FStructFallback;
                        var points = position?.Properties.FirstOrDefault(p => p.Name.Text == "Points")?.Tag?.GenericValue as UScriptArray;
                        Console.WriteLine($"       spline point count = {points?.Properties.Count ?? -1}");
                        if (points != null)
                        {
                            foreach (var splinePoint in points.Properties.Take(8))
                            {
                                var pointStruct = splinePoint.GenericValue as FStructFallback;
                                var outVal = pointStruct?.Properties.FirstOrDefault(p => p.Name.Text == "OutVal")?.Tag?.GenericValue;
                                Console.WriteLine($"         pt OutVal = {outVal}");
                            }
                        }
                    }
                }

                var splineMeshes = actor.GetOrDefault<UScriptArray?>("mSplineMeshComponents");
                Console.WriteLine($"  splineMeshComponents count = {splineMeshes?.Properties.Count ?? -1}");
                if (splineMeshes != null && splineMeshes.Properties.Count > 0)
                {
                    for (var si = 0; si < Math.Min(4, splineMeshes.Properties.Count); si++)
                    {
                        var splineMesh = (splineMeshes.Properties[si].GenericValue as FPackageIndex)?.ResolvedObject?.Load();
                        if (splineMesh == null)
                        {
                            continue;
                        }

                        var rawParams = splineMesh.Properties.FirstOrDefault(p => p.Name.Text == "SplineParams")?.Tag?.GenericValue;
                        var splineParams = rawParams as FStructFallback ?? (rawParams as FScriptStruct)?.StructType as FStructFallback;
                        if (si == 0)
                        {
                            Console.WriteLine($"       SplineParams runtime = {rawParams?.GetType().Name}; inner = {(rawParams as FScriptStruct)?.StructType?.GetType().Name}");
                        }

                        if (splineParams == null)
                        {
                            Console.WriteLine($"       smc{si} SP unwrap failed");
                            continue;
                        }

                        Console.WriteLine($"       smc{si} SP fields:");
                        foreach (var field in splineParams.Properties)
                        {
                            Console.WriteLine($"            .{field.Name.Text} = {field.Tag?.GenericValue}  [{field.Tag?.GenericValue?.GetType().Name}]");
                        }

                        if (si == 0)
                        {
                            var mesh = (splineMesh.Properties.FirstOrDefault(p => p.Name.Text == "StaticMesh")?.Tag?.GenericValue as FPackageIndex)?.ResolvedObject?.Load() as UStaticMesh;
                            if (mesh?.RenderData?.Bounds != null)
                            {
                                Console.WriteLine($"       SM_RiverPlane bounds: origin={mesh.RenderData.Bounds.Origin} extent={mesh.RenderData.Bounds.BoxExtent}");
                            }
                        }
                    }
                }

                Console.WriteLine("\nDONE");
                return;
            }
            catch
            {
                // Skip a package that fails to load, as before.
            }
        }

        Console.WriteLine("no river package found\nDONE");
    }
}
