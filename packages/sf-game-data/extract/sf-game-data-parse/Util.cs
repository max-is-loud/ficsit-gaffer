// Tolerant readers for fields of a raw docs JSON object: strings, numbers (which the docs often
// store as strings) and sub-elements, each with a default when absent or malformed.

using System.Globalization;
using System.Text.Json;

namespace SfGameData.Parse;

// Ported from @foreman/sf-game-data/src/parser/util.ts. A "raw class" is a
// JsonElement object straight from the docs file; these read its fields with the
// same tolerance as the TS helpers (numbers are often stored as strings such as
// "6.000000").
public static class Util
{
    public static bool IsRecord(JsonElement value) => value.ValueKind == JsonValueKind.Object;

    private static bool TryProp(JsonElement obj, string key, out JsonElement value)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(key, out value))
        {
            return true;
        }
        value = default;
        return false;
    }

    /// <summary>Reads a string field, returning "" when absent or not a string.</summary>
    public static string GetString(JsonElement obj, string key)
        => TryProp(obj, key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";

    /// <summary>
    /// Reads a numeric field. Several docs numbers are stored as strings (e.g.
    /// "6.000000"); both forms are handled. Returns <paramref name="fallback"/>
    /// when absent or unparseable.
    /// </summary>
    public static double GetNumber(JsonElement obj, string key, double fallback = 0)
    {
        if (!TryProp(obj, key, out var v))
        {
            return fallback;
        }
        if (v.ValueKind == JsonValueKind.Number)
        {
            return v.GetDouble();
        }
        if (v.ValueKind == JsonValueKind.String)
        {
            var s = v.GetString()!;
            if (s.Trim().Length > 0
                && double.TryParse(s.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
                && double.IsFinite(parsed))
            {
                return parsed;
            }
        }
        return fallback;
    }

    /// <summary>Returns the named property as an element, or a default (Undefined) element.</summary>
    public static JsonElement GetElement(JsonElement obj, string key)
        => TryProp(obj, key, out var v) ? v : default;
}
