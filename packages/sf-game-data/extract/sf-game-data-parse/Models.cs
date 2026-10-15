// Output model of the docs parse (Item, Recipe, Building, Schematic, GameData and their parts),
// mirroring the TypeScript GameData types so the serialised JSON has the same shape.

namespace SfGameData.Parse;

// Parser output model, ported 1:1 from the TypeScript types in
// @foreman/sf-game-data/src/parser/types.ts. Every TS `number` is a C# `double`
// so JSON number formatting matches (both runtimes emit shortest round-trippable
// floats). String-literal unions (ItemForm, IngredientUnit, SchematicType) are
// plain strings to preserve exact values such as "m³". Optional fields are
// nullable and omitted when null (see ParseJson.Options), matching TS `?` fields.

public sealed class Item
{
    public string ClassName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Description { get; set; } = "";
    public double StackSize { get; set; }
    public string Form { get; set; } = "invalid";
    public double SinkPoints { get; set; }
    public double EnergyValue { get; set; }
    public bool IsResource { get; set; }
}

public sealed class Ingredient
{
    public string ItemClassName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public double Amount { get; set; }
    public double PerMinute { get; set; }
    public string Unit { get; set; } = "items";
}

public sealed class VariablePower
{
    public double Min { get; set; }
    public double Max { get; set; }
}

public sealed class Recipe
{
    public string ClassName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public bool IsAlternate { get; set; }
    public double CraftTime { get; set; }
    public List<Ingredient> Ingredients { get; set; } = [];
    public List<Ingredient> Products { get; set; } = [];
    public List<string> ProducedIn { get; set; } = [];
    public List<string> ProducedInClasses { get; set; } = [];
    public bool InBuildGun { get; set; }
    public bool InWorkshop { get; set; }
    public VariablePower? VariablePower { get; set; }
}

public sealed class BuildCostLine
{
    public string ItemClassName { get; set; } = "";
    public double Amount { get; set; }
}

public sealed class FuelFlow
{
    public string ItemClassName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public double PerMinute { get; set; }
    public string Unit { get; set; } = "items";
}

public sealed class GeneratorFuel
{
    public FuelFlow Fuel { get; set; } = new();
    public FuelFlow? Supplemental { get; set; }
    public FuelFlow? Byproduct { get; set; }
}

public sealed class Building
{
    public string ClassName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "";
    public double PowerConsumption { get; set; }
    public double? MaxPowerConsumption { get; set; }
    public double? PowerProduction { get; set; }
    public bool? VariablePowerProduction { get; set; }
    public List<GeneratorFuel>? Fuels { get; set; }
    public double? ConveyorSpeedPerMin { get; set; }
    public double? PipeFlowPerMin { get; set; }
    /// <summary>Pump design head lift in metres (<c>mDesignPressure</c>). Present only for pipeline pumps.</summary>
    public double? HeadLiftMetres { get; set; }
    public double? ExtractionRatePerMin { get; set; }
    public List<BuildCostLine> BuildCost { get; set; } = [];
}

public sealed class Schematic
{
    public string ClassName { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Type { get; set; } = "other";
    public double Tier { get; set; }
    public List<Ingredient> Cost { get; set; } = [];
    public List<string> UnlocksRecipes { get; set; } = [];
    public List<string> UnlocksBuildings { get; set; } = [];
    public List<string> UnlocksItems { get; set; } = [];
}

public sealed class GameData
{
    public string Version { get; set; } = "unknown";
    public long? Build { get; set; }
    public string ParsedAt { get; set; } = "";
    public Dictionary<string, Item> Items { get; set; } = [];
    public Dictionary<string, Item> Resources { get; set; } = [];
    public Dictionary<string, Recipe> Recipes { get; set; } = [];
    public Dictionary<string, Building> Buildings { get; set; } = [];
    public Dictionary<string, Schematic> Schematics { get; set; } = [];
}

public sealed class ParseResult
{
    public GameData GameData { get; set; } = new();
    public List<string> ParseWarnings { get; set; } = [];
}
