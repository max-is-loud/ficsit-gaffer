// Extension methods that read a scene component's relative location, scale, rotation, yaw and mesh
// reference, falling back to the game's defaults when a property is absent.

namespace SfMapRenderer.Assets;

/// <summary>
/// Reads the standard scene-component transform properties with the game's defaults (absent scale = 1,
/// absent location/rotation = 0). Centralises a pattern the old renderer repeated at every call site.
/// </summary>
public static class ComponentProperties
{
    public static bool HasRelativeLocation(this UObject component) =>
        component.Properties.Any(p => p.Name.Text == "RelativeLocation");

    public static FVector RelativeLocation(this UObject component) =>
        component.HasRelativeLocation() ? component.GetOrDefault<FVector>("RelativeLocation") : new FVector(0, 0, 0);

    public static FVector RelativeScale(this UObject component) =>
        component.Properties.Any(p => p.Name.Text == "RelativeScale3D")
            ? component.GetOrDefault<FVector>("RelativeScale3D")
            : new FVector(1, 1, 1);

    public static FRotator RelativeRotation(this UObject component) =>
        component.Properties.Any(p => p.Name.Text == "RelativeRotation")
            ? component.GetOrDefault<FRotator>("RelativeRotation")
            : new FRotator(0, 0, 0);

    /// <summary>Yaw in radians (the only rotation component the water/river/volume transforms use).</summary>
    public static double RelativeYawRadians(this UObject component) =>
        (component.Properties.Any(p => p.Name.Text == "RelativeRotation")
            ? component.GetOrDefault<FRotator>("RelativeRotation").Yaw
            : 0.0) * Math.PI / 180.0;

    /// <summary>The mesh reference on a StaticMeshComponent (or another named mesh property).</summary>
    public static FPackageIndex? MeshIndex(this UObject component, string property = "StaticMesh") =>
        component.Properties.FirstOrDefault(p => p.Name.Text == property)?.Tag?.GenericValue as FPackageIndex;
}
