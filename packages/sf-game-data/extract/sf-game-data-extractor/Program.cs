// Entry point of the offline extractor: resolves --flags and environment variables, runs the world
// extraction and the en-US.json parse, then writes one merged sf-game-data.json.

using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using SfGameData.Extraction;
using SfGameData.Parse;

// sf-game-data-extractor — the single offline producer of the bundled game-data
// dataset (see docs/sf-game-data-extractor.md). It parses en-US.json (the C#
// parser, #159) and extracts the world data from the cooked assets (CUE4Parse,
// #158), then writes ONE merged sf-game-data.json (#160): the existing world
// fields plus a top-level `gameData` object. The shape is additive, so the
// runtime world loader keeps working until it switches to gameData (#161).
//
// Inputs come from --flags, then environment variables, then defaults. Flags
// avoid shell-quoting pitfalls when running over SSH on the Windows host.
//   --paks <dir>      SF_PAKS         the install's FactoryGame/Content/Paks
//   --usmap <file>    SF_USMAP        CommunityResources/FactoryGame.usmap
//   --enus <file>     SF_DOCS         CommunityResources/Docs/en-US.json
//   --out <file>      OUT             output path (default sf-game-data.json)
//   --version <str>   GAME_VERSION    stamped gameVersion (must match meta.json)
//   --build <int>     BUILD           stamped build (must match meta.json)

var flags = ParseFlags(args);
string Resolve(string flag, string env, string fallback) =>
    flags.GetValueOrDefault(flag) ?? Environment.GetEnvironmentVariable(env) ?? fallback;

const string steam = @"D:\Games\Steam\steamapps\common\Satisfactory";
var paks = Resolve("paks", "SF_PAKS", $@"{steam}\FactoryGame\Content\Paks");
var usmap = Resolve("usmap", "SF_USMAP", $@"{steam}\CommunityResources\FactoryGame.usmap");
var enus = Resolve("enus", "SF_DOCS", $@"{steam}\CommunityResources\Docs\en-US.json");
var outPath = Resolve("out", "OUT", "sf-game-data.json");
var version = Resolve("version", "GAME_VERSION", "1.2.3.0");
var build = int.TryParse(Resolve("build", "BUILD", "493833"), out var parsedBuild) ? parsedBuild : 493833;

// 1. World data from the cooked assets (returns the dataset object + the
// project-assembly phase deliverable costs, which are cooked-asset game data).
var extracted = WorldExtractor.Extract(new ExtractOptions(paks, usmap, version, build));
var world = extracted.Dataset;

// 2. gameData from en-US.json (items/recipes/buildings/schematics).
Console.WriteLine($"parsing docs: {enus}");
var parsed = DocsReader.ParseDocsFile(enus, version, build);
var g = parsed.GameData;
Console.WriteLine(
    $"  gameData items={g.Items.Count} resources={g.Resources.Count} recipes={g.Recipes.Count} "
    + $"buildings={g.Buildings.Count} schematics={g.Schematics.Count}");

// 3. Merge: serialise the world dataset to a node and attach gameData, then write
// one file. Relaxed escaping keeps '+'/'m³' literal; always LF (the indented
// serialiser emits CRLF on Windows, but the committed dataset is LF).
var writeOptions = new JsonSerializerOptions
{
    WriteIndented = true,
    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
};
var merged = (JsonObject)JsonSerializer.SerializeToNode(world, writeOptions)!;
var gameDataNode = (JsonObject)JsonSerializer.SerializeToNode(g, ParseJson.Options)!;
// Project-assembly phase costs are game data, but come from the cooked assets (CUE4Parse),
// not the Docs parse — attach them under gameData (camelCase, like the rest of the node).
gameDataNode["projectAssemblyPhases"] = JsonSerializer.SerializeToNode(extracted.ProjectAssemblyPhases, ParseJson.Options);
merged["gameData"] = gameDataNode;
var json = merged.ToJsonString(writeOptions).Replace("\r\n", "\n");
File.WriteAllText(outPath, json);

Console.WriteLine($"written -> {outPath}");
Console.WriteLine("DONE");

static Dictionary<string, string> ParseFlags(string[] argv)
{
    var result = new Dictionary<string, string>();
    for (var i = 0; i < argv.Length - 1; i++)
    {
        if (argv[i].StartsWith("--", StringComparison.Ordinal))
        {
            result[argv[i][2..]] = argv[i + 1];
            i++;
        }
    }
    return result;
}
