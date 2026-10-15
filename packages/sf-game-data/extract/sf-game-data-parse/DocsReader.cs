// Reads the game's en-US.json docs file: detects its encoding (UTF-16 LE or UTF-8, with or without
// a BOM), decodes it and hands the parsed JSON to GameDataParser.

using System.Text;
using System.Text.Json;

namespace SfGameData.Parse;

// Ported from src/parser/reader.ts. Decodes the docs file (the game ships it as
// UTF-16 LE) and parses the JSON.
public static class DocsReader
{
    /// <summary>
    /// Decodes a docs-file buffer to a string, handling UTF-16 LE (with or without
    /// BOM) and UTF-8. A leading byte-order mark (U+FEFF) is stripped when present.
    /// </summary>
    public static string DecodeBuffer(byte[] buffer)
    {
        string text;
        if (buffer.Length >= 2 && buffer[0] == 0xFF && buffer[1] == 0xFE)
        {
            text = Encoding.Unicode.GetString(buffer); // UTF-16 LE
        }
        else if (buffer.Length >= 3 && buffer[0] == 0xEF && buffer[1] == 0xBB && buffer[2] == 0xBF)
        {
            text = Encoding.UTF8.GetString(buffer);
        }
        else if (buffer.Length >= 2 && buffer[1] == 0x00)
        {
            // No BOM, but a NUL high byte after the leading ASCII '[' marks UTF-16 LE.
            text = Encoding.Unicode.GetString(buffer);
        }
        else
        {
            text = Encoding.UTF8.GetString(buffer);
        }
        return text.Length > 0 && text[0] == '\uFEFF' ? text[1..] : text;
    }

    /// <summary>Reads, decodes and JSON-parses the docs file. The caller owns disposal.</summary>
    public static JsonDocument ReadDocsFile(string filePath)
        => JsonDocument.Parse(DecodeBuffer(File.ReadAllBytes(filePath)));

    /// <summary>Reads and parses the docs file at <paramref name="filePath"/> into GameData.</summary>
    public static ParseResult ParseDocsFile(string filePath, string version, long? build)
    {
        using var doc = ReadDocsFile(filePath);
        return GameDataParser.ParseGameData(doc.RootElement, version, build);
    }
}
