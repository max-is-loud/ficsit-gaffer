// The ROCKAT probe: during the rock pass, records which mesh instances rasterise onto each target
// cell, so a rendered landmass can be traced to the instances to exclude.

namespace SfMapRenderer.Diagnostics;

/// <summary>
/// The ROCKAT footprint probe: during the rock pass it records which mesh instances rasterise onto each
/// target cell (mesh @ origin, z, scale), so a rendered landmass can be traced to the exact instances to
/// exclude via the rock-exclusion list.
/// </summary>
public sealed class RockFootprintProbe
{
    public readonly record struct Target(int Column, int Row, string Label);

    private readonly IReadOnlyList<Target> _targets;
    private readonly int _width;
    private readonly Dictionary<int, HashSet<string>> _hits = [];

    public RockFootprintProbe(IReadOnlyList<Target> targets, int width)
    {
        _targets = targets;
        _width = width;
    }

    public bool HasTargets => _targets.Count > 0;

    public void Observe(int column, int row, string meshName, double originX, double originY, double z, double scaleZ)
    {
        foreach (var target in _targets)
        {
            if (Math.Abs(column - target.Column) <= 1 && Math.Abs(row - target.Row) <= 1)
            {
                var key = target.Row * _width + target.Column;
                if (!_hits.TryGetValue(key, out var set))
                {
                    set = [];
                    _hits[key] = set;
                }

                set.Add($"{meshName}@{originX:F0},{originY:F0} (z={z:F0},scale={scaleZ:F1})");
            }
        }
    }

    public void Report()
    {
        foreach (var target in _targets)
        {
            Console.WriteLine($"ROCKAT {target.Label} (cell {target.Column},{target.Row}):");
            if (_hits.TryGetValue(target.Row * _width + target.Column, out var set))
            {
                foreach (var line in set.OrderByDescending(x => x))
                {
                    Console.WriteLine($"    {line}");
                }
            }
            else
            {
                Console.WriteLine("    (no rock rasterised here)");
            }
        }
    }
}
