// Orchestrates the docs parse: buckets raw classes by category, runs the item, building, recipe and
// schematic extractors in dependency order, and returns GameData with collected warnings.

using System.Text.Json;

namespace SfGameData.Parse;

// Collects non-fatal parse warnings. Nothing in the parser ever throws.
public sealed class Warnings
{
    private readonly List<string> _messages = [];
    public void Add(string message) => _messages.Add(message);
    public List<string> All() => [.. _messages];
}

// Ported from src/parser/index.ts — orchestrates the extractors into GameData.
public static class GameDataParser
{
    private sealed class Buckets
    {
        public List<JsonElement> Items { get; } = [];
        public List<JsonElement> Resources { get; } = [];
        public List<(JsonElement Raw, string ShortName)> Buildings { get; } = [];
        public List<JsonElement> Recipes { get; } = [];
        public List<JsonElement> Schematics { get; } = [];
    }

    public static GameData EmptyGameData(string version, long? build) => new()
    {
        Version = version,
        Build = build,
        // Excluded from the golden-diff (inherently non-deterministic); the merge
        // step (#160) will decide the final stamp. Mirrors `new Date().toISOString()`.
        ParsedAt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
    };

    private static Buckets BucketRawClasses(JsonElement raw, Warnings warnings)
    {
        var buckets = new Buckets();
        if (raw.ValueKind != JsonValueKind.Array)
        {
            warnings.Add("Docs file root is not an array; no data extracted.");
            return buckets;
        }

        // First-seen order preserved (mirrors the JS Map) so warning order is stable.
        var skippedOrder = new List<string>();
        var skipped = new Dictionary<string, int>();
        foreach (var group in raw.EnumerateArray())
        {
            if (!Util.IsRecord(group))
            {
                continue;
            }
            var nativeClassEl = Util.GetElement(group, "NativeClass");
            if (nativeClassEl.ValueKind != JsonValueKind.String)
            {
                continue;
            }
            var shortName = ClassMap.ShortNameFromNativeClass(nativeClassEl.GetString()!);
            var classes = Util.GetElement(group, "Classes");
            if (classes.ValueKind != JsonValueKind.Array)
            {
                continue;
            }
            var category = ClassMap.CategoryFor(shortName);
            if (category is null)
            {
                if (!skipped.ContainsKey(shortName))
                {
                    skippedOrder.Add(shortName);
                }
                skipped[shortName] = skipped.GetValueOrDefault(shortName) + classes.GetArrayLength();
                continue;
            }
            foreach (var entry in classes.EnumerateArray())
            {
                if (!Util.IsRecord(entry))
                {
                    continue;
                }
                switch (category)
                {
                    case Category.Item:
                        buckets.Items.Add(entry);
                        break;
                    case Category.Resource:
                        buckets.Resources.Add(entry);
                        break;
                    case Category.Building:
                        buckets.Buildings.Add((entry, shortName));
                        break;
                    case Category.Recipe:
                        buckets.Recipes.Add(entry);
                        break;
                    case Category.Schematic:
                        buckets.Schematics.Add(entry);
                        break;
                }
            }
        }

        foreach (var shortName in skippedOrder)
        {
            var count = skipped[shortName];
            warnings.Add(
                $"Skipped {count} entr{(count == 1 ? "y" : "ies")} of unrecognised class '{shortName}'.");
        }
        return buckets;
    }

    /// <summary>
    /// Parses the raw docs JSON into clean GameData. Never throws on bad entries —
    /// problems are collected into ParseWarnings.
    /// </summary>
    public static ParseResult ParseGameData(JsonElement raw, string version, long? build)
    {
        var warnings = new Warnings();
        var buckets = BucketRawClasses(raw, warnings);
        var gameData = EmptyGameData(version, build);

        // 1. Items and resources first — recipes need item forms for fluid scaling.
        foreach (var rawItem in buckets.Items)
        {
            var item = Items.ItemFromRaw(rawItem, false);
            if (item.ClassName != "")
            {
                gameData.Items[item.ClassName] = item;
            }
        }
        foreach (var rawResource in buckets.Resources)
        {
            var resource = Items.ItemFromRaw(rawResource, true);
            if (resource.ClassName != "")
            {
                gameData.Resources[resource.ClassName] = resource;
            }
        }

        // Combined item lookups (manufactured items + raw resources).
        var itemForm = new Dictionary<string, string>();
        var itemDisplay = new Dictionary<string, string>();
        var itemClasses = new HashSet<string>();
        var itemsByClass = new Dictionary<string, Item>();
        foreach (var item in gameData.Items.Values.Concat(gameData.Resources.Values))
        {
            itemForm[item.ClassName] = item.Form;
            itemDisplay[item.ClassName] = item.DisplayName;
            itemClasses.Add(item.ClassName);
            itemsByClass[item.ClassName] = item;
        }

        // 2. Buildings (need item energy values to derive generator fuel rates).
        foreach (var (rawBuilding, shortName) in buckets.Buildings)
        {
            var building = Buildings.BuildingFromRaw(rawBuilding, shortName, itemsByClass);
            if (building.ClassName != "")
            {
                gameData.Buildings[building.ClassName] = building;
            }
        }
        var buildingDisplay = new Dictionary<string, string>();
        var buildingClasses = new HashSet<string>();
        foreach (var building in gameData.Buildings.Values)
        {
            buildingDisplay[building.ClassName] = building.DisplayName;
            buildingClasses.Add(building.ClassName);
        }

        var recipeLookups = new RecipeLookups
        {
            ItemForm = itemForm,
            ItemDisplay = itemDisplay,
            BuildingDisplay = buildingDisplay,
            BuildingClasses = buildingClasses,
        };

        // 3. Recipes — split build-gun (build costs) from production recipes.
        var buildRecipeToBuilding = new Dictionary<string, string>();
        var unlinkedBuildCosts = 0;
        foreach (var rawRecipe in buckets.Recipes)
        {
            if (Recipes.IsBuildGunRecipe(rawRecipe))
            {
                var buildRecipe = Recipes.ExtractBuildRecipe(rawRecipe);
                var recipeClassName = Util.GetString(rawRecipe, "ClassName");
                if (buildRecipe is null)
                {
                    continue;
                }
                var building = gameData.Buildings.GetValueOrDefault(buildRecipe.BuildingClassName);
                if (building is not null)
                {
                    building.BuildCost = buildRecipe.Cost;
                    if (recipeClassName != "")
                    {
                        buildRecipeToBuilding[recipeClassName] = buildRecipe.BuildingClassName;
                    }
                }
                else
                {
                    unlinkedBuildCosts += 1;
                }
                continue;
            }
            var recipe = Recipes.ExtractRecipe(rawRecipe, recipeLookups);
            if (recipe.ClassName != "")
            {
                gameData.Recipes[recipe.ClassName] = recipe;
            }
        }
        if (unlinkedBuildCosts > 0)
        {
            warnings.Add(
                $"{unlinkedBuildCosts} build recipe(s) could not be linked to a building by name heuristic.");
        }

        // 4. Schematics (need production recipe + build recipe maps).
        var schematicLookups = new SchematicLookups
        {
            ItemForm = itemForm,
            ItemDisplay = itemDisplay,
            ItemClasses = itemClasses,
            ProductionRecipeClasses = [.. gameData.Recipes.Keys],
            BuildRecipeToBuilding = buildRecipeToBuilding,
        };
        foreach (var rawSchematic in buckets.Schematics)
        {
            var schematic = Schematics.ExtractSchematic(rawSchematic, schematicLookups);
            if (schematic.ClassName != "")
            {
                gameData.Schematics[schematic.ClassName] = schematic;
            }
        }

        warnings.Add(
            $"Parsed {gameData.Items.Count} items, {gameData.Resources.Count} resources, "
            + $"{gameData.Recipes.Count} recipes, {gameData.Buildings.Count} buildings, "
            + $"{gameData.Schematics.Count} schematics (version: {version}).");

        return new ParseResult { GameData = gameData, ParseWarnings = warnings.All() };
    }
}
