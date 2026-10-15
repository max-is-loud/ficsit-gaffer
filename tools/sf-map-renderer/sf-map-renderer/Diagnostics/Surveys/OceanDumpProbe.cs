// Standalone survey: writes every ocean and water surface feature (position, Z and type) to
// oceandump.tsv.

using SfMapRenderer.Assets;

namespace SfMapRenderer.Diagnostics.Surveys;

/// <summary>Dumps every ocean/water surface feature (X,Y,Z + type) to oceandump.tsv (was MODE=oceandump).</summary>
public static class OceanDumpProbe
{
    public static void Report(GameAssetProvider assets)
    {
        FVector RelativeLocationOf(UObject? component) =>
            component != null && component.HasRelativeLocation() ? component.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);

        var lines = new List<string>();
        foreach (var package in assets.PersistentLevelPackages())
        {
            foreach (var export in assets.Provider.LoadPackage(package).GetExports())
            {
                if (export.ExportType.Contains("OceanSpline", StringComparison.Ordinal))
                {
                    var location = RelativeLocationOf(export.GetOrDefault<UObject?>("RootComponent") ?? export.GetOrDefault<UObject?>("DefaultSceneRoot"));
                    lines.Add($"OceanSpline\t{location.X:F0}\t{location.Y:F0}\t{location.Z:F0}");
                }
                else if (export.ExportType == "BP_WaterPlane_C")
                {
                    var mesh = export.GetOrDefault<UObject?>("SourceMesh") as UStaticMesh;
                    var bounds = mesh?.RenderData?.Bounds;
                    if (bounds != null)
                    {
                        lines.Add($"WaterPlane\t{bounds.Origin.X:F0}\t{bounds.Origin.Y:F0}\t{bounds.Origin.Z:F0}");
                    }
                }
                else if (export.ExportType.Contains("Water", StringComparison.Ordinal))
                {
                    var surface = export.GetOrDefault<UObject?>("WaterSurface");
                    if (surface != null && surface.HasRelativeLocation())
                    {
                        var location = surface.GetOrDefault<FVector>("RelativeLocation");
                        lines.Add($"{export.ExportType}\t{location.X:F0}\t{location.Y:F0}\t{location.Z:F0}");
                    }
                }
            }
        }

        File.WriteAllLines(Path.Combine(Directory.GetCurrentDirectory(), "oceandump.tsv"), lines);
        Console.WriteLine($"wrote oceandump.tsv ({lines.Count} features)");
        Console.WriteLine("DONE");
    }
}
