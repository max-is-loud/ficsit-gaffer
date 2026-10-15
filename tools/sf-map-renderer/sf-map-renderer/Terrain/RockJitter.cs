// A deterministic per-instance brightness and warm/cool colour jitter for placed rock, hashed from
// world position so renders are repeatable.

namespace SfMapRenderer.Terrain;

/// <summary>
/// A subtle, deterministic per-instance colour jitter for placed rock, so two rocks of the same family (which
/// share one sampled material colour) don't read as one flat tone. Hashed from the instance's world position, so
/// it is stable across renders. Varies brightness plus a small warm/cool tilt; strength 0 is a no-op.
/// </summary>
public static class RockJitter
{
    /// <summary>Per-channel multiplier for a rock instance at <paramref name="location"/>.</summary>
    public static (double R, double G, double B) Factor(FVector location, double strength)
    {
        if (strength <= 0)
        {
            return (1.0, 1.0, 1.0);
        }

        var brightness = 1.0 + strength * (2.0 * Hash(location, 0) - 1.0);
        var tilt = 0.5 * strength * (2.0 * Hash(location, 1) - 1.0);
        return (brightness * (1.0 + tilt), brightness, brightness * (1.0 - tilt));
    }

    // A stable [0,1) hash of a rounded world position (+ a salt for a second independent draw).
    private static double Hash(FVector location, int salt)
    {
        var x = (long)Math.Round(location.X);
        var y = (long)Math.Round(location.Y);
        var z = (long)Math.Round(location.Z);
        var h = (ulong)(x * 73856093L) ^ (ulong)(y * 19349663L) ^ (ulong)(z * 83492791L) ^ (ulong)(salt * 2654435761L);
        h ^= h >> 33;
        h *= 0xff51afd7ed558ccdUL;
        h ^= h >> 33;
        h *= 0xc4ceb9fe1a85ec53UL;
        h ^= h >> 33;
        return (h & 0xFFFFFFUL) / (double)0x1000000UL;
    }
}
