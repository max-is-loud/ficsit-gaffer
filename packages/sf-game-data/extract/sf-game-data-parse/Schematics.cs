// Builds Schematic records from docs classes: type, tier, cost and the recipes, items and buildings
// each one unlocks.

using System.Text.Json;

namespace SfGameData.Parse;

// Lookups built from already-parsed items, recipes and buildings.
public sealed class SchematicLookups
{
    public Dictionary<string, string> ItemForm { get; init; } = [];
    public Dictionary<string, string> ItemDisplay { get; init; } = [];
    public HashSet<string> ItemClasses { get; init; } = [];
    public HashSet<string> ProductionRecipeClasses { get; init; } = [];
    public Dictionary<string, string> BuildRecipeToBuilding { get; init; } = [];
}

// Ported from src/parser/extractors/schematics.ts.
public static class Schematics
{
    private static readonly Dictionary<string, string> TypeMap = new()
    {
        ["EST_Milestone"] = "milestone",
        ["EST_MAM"] = "mam",
        ["EST_ResourceSink"] = "awesome_shop",
        ["EST_HardDrive"] = "hard_drive",
        ["EST_Alternate"] = "hard_drive",
        ["EST_Tutorial"] = "tutorial",
    };

    private static string MapType(string raw) => TypeMap.GetValueOrDefault(raw, "other");

    // Cost lines carry no production rate, so perMinute is 0.
    private static List<Ingredient> MapCost(string raw, SchematicLookups lookups)
        => Normalise.ParseItemAmountList(raw).Select(item =>
        {
            var form = lookups.ItemForm.GetValueOrDefault(item.ClassName, "solid");
            var display = Normalise.ToDisplayAmount(item.Amount, form);
            return new Ingredient
            {
                ItemClassName = item.ClassName,
                DisplayName = lookups.ItemDisplay.GetValueOrDefault(item.ClassName, ""),
                Amount = display.Amount,
                PerMinute = 0,
                Unit = display.Unit,
            };
        }).ToList();

    // The TS reads unlock[field] only when it is a string; GetString returns "" for
    // a missing/non-string field, and ExtractClassNames("") is [], so this matches.
    private static List<string> CollectUnlockField(JsonElement unlock, string field)
        => ClassRef.ExtractClassNames(Util.GetString(unlock, field));

    public static Schematic ExtractSchematic(JsonElement raw, SchematicLookups lookups)
    {
        var className = Util.GetString(raw, "ClassName");

        var unlocksRecipes = new List<string>();
        var unlocksBuildings = new List<string>();
        var unlocksItems = new List<string>();

        var rawUnlocks = Util.GetElement(raw, "mUnlocks");
        if (rawUnlocks.ValueKind == JsonValueKind.Array)
        {
            foreach (var unlock in rawUnlocks.EnumerateArray())
            {
                if (!Util.IsRecord(unlock))
                {
                    continue;
                }
                foreach (var recipeClass in CollectUnlockField(unlock, "mRecipes")
                    .Concat(CollectUnlockField(unlock, "mBlueprints")))
                {
                    if (lookups.ProductionRecipeClasses.Contains(recipeClass))
                    {
                        unlocksRecipes.Add(recipeClass);
                    }
                    else if (lookups.BuildRecipeToBuilding.TryGetValue(recipeClass, out var building))
                    {
                        unlocksBuildings.Add(building);
                    }
                }
                foreach (var itemClass in CollectUnlockField(unlock, "mItemDescriptors")
                    .Concat(CollectUnlockField(unlock, "mItemsToGive")))
                {
                    if (lookups.ItemClasses.Contains(itemClass))
                    {
                        unlocksItems.Add(itemClass);
                    }
                }
            }
        }

        return new Schematic
        {
            ClassName = className,
            DisplayName = Util.GetString(raw, "mDisplayName"),
            Type = MapType(Util.GetString(raw, "mType")),
            Tier = Util.GetNumber(raw, "mTechTier", 0),
            Cost = MapCost(Util.GetString(raw, "mCost"), lookups),
            UnlocksRecipes = Dedupe(unlocksRecipes),
            UnlocksBuildings = Dedupe(unlocksBuildings),
            UnlocksItems = Dedupe(unlocksItems),
        };
    }

    private static List<string> Dedupe(List<string> values)
    {
        var seen = new HashSet<string>();
        var output = new List<string>();
        foreach (var value in values)
        {
            if (seen.Add(value))
            {
                output.Add(value);
            }
        }
        return output;
    }
}
