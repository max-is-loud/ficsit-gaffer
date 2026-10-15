// Holds the JSON serialiser options (camelCase, nulls omitted, relaxed escaping) used to write the
// parsed GameData.

using System.Text.Encodings.Web;
using System.Text.Json;

namespace SfGameData.Parse;

// Shared serialization options for the parsed GameData. camelCase keys + omitted
// null optionals mirror the TypeScript parser's JSON shape; relaxed escaping keeps
// values such as "m³" literal. Number formatting is .NET's shortest round-trip,
// which matches JS — and the golden-diff compares values, not strings, regardless.
public static class ParseJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = true,
    };

    public static string Serialize(GameData gameData) => JsonSerializer.Serialize(gameData, Options);
}
