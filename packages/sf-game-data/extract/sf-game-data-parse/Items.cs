// Builds Item records (and raw resources) from docs classes: form, stack size, sink points and
// energy value.

using System.Text.Json;

namespace SfGameData.Parse;

// Ported from src/parser/extractors/items.ts.
public static class Items
{
    private static readonly Dictionary<string, string> FormMap = new()
    {
        ["RF_SOLID"] = "solid",
        ["RF_LIQUID"] = "liquid",
        ["RF_GAS"] = "gas",
        ["RF_INVALID"] = "invalid",
    };

    // Stack-size enum → count, used when mCachedStackSize is absent.
    private static readonly Dictionary<string, double> StackSizeMap = new()
    {
        ["SS_ONE"] = 1,
        ["SS_SMALL"] = 50,
        ["SS_MEDIUM"] = 100,
        ["SS_BIG"] = 200,
        ["SS_HUGE"] = 500,
        ["SS_FLUID"] = 0,
    };

    public static string MapForm(string raw) => FormMap.GetValueOrDefault(raw, "invalid");

    private static double ResolveStackSize(JsonElement raw)
    {
        var cached = Util.GetNumber(raw, "mCachedStackSize", double.NaN);
        if (double.IsFinite(cached) && cached > 0)
        {
            return cached;
        }
        var enumValue = Util.GetString(raw, "mStackSize");
        return StackSizeMap.GetValueOrDefault(enumValue, 0);
    }

    public static Item ItemFromRaw(JsonElement raw, bool isResource) => new()
    {
        ClassName = Util.GetString(raw, "ClassName"),
        DisplayName = Util.GetString(raw, "mDisplayName"),
        Description = Util.GetString(raw, "mDescription"),
        StackSize = ResolveStackSize(raw),
        Form = MapForm(Util.GetString(raw, "mForm")),
        SinkPoints = Util.GetNumber(raw, "mResourceSinkPoints", 0),
        EnergyValue = Util.GetNumber(raw, "mEnergyValue", 0),
        IsResource = isResource,
    };
}
