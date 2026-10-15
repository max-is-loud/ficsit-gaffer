// Builds Recipe records from docs classes, with ingredient and product amounts scaled for fluids,
// and resolves build-gun recipes into the building they construct and its cost.

using System.Text.Json;

namespace SfGameData.Parse;

// Lookups built from already-parsed items, resources and buildings.
public sealed class RecipeLookups
{
    public Dictionary<string, string> ItemForm { get; init; } = [];
    public Dictionary<string, string> ItemDisplay { get; init; } = [];
    public Dictionary<string, string> BuildingDisplay { get; init; } = [];
    public HashSet<string> BuildingClasses { get; init; } = [];
}

// A build-gun recipe resolved to the building it constructs and its cost.
public sealed class BuildRecipe
{
    public string BuildingClassName { get; init; } = "";
    public List<BuildCostLine> Cost { get; init; } = [];
}

// Ported from src/parser/extractors/recipes.ts.
public static class Recipes
{
    public static bool IsBuildGunRecipe(JsonElement raw)
        => Util.GetString(raw, "mProducedIn").Contains("BuildGun", StringComparison.OrdinalIgnoreCase);

    private static bool IsAlternateRecipe(string className, string displayName)
        => className.Contains("Alternate", StringComparison.OrdinalIgnoreCase)
            || displayName.StartsWith("Alternate", StringComparison.OrdinalIgnoreCase);

    private static string ResolveForm(RecipeLookups lookups, string className)
        => lookups.ItemForm.GetValueOrDefault(className, "solid");

    private static string ResolveDisplay(RecipeLookups lookups, string className)
        => lookups.ItemDisplay.GetValueOrDefault(className, "");

    private static Ingredient MapIngredient(RawItemAmount rawItem, double craftTime, RecipeLookups lookups)
    {
        var form = ResolveForm(lookups, rawItem.ClassName);
        var display = Normalise.ToDisplayAmount(rawItem.Amount, form);
        return new Ingredient
        {
            ItemClassName = rawItem.ClassName,
            DisplayName = ResolveDisplay(lookups, rawItem.ClassName),
            Amount = display.Amount,
            PerMinute = Normalise.PerMinute(display.Amount, craftTime),
            Unit = display.Unit,
        };
    }

    private static VariablePower? ResolveVariablePower(JsonElement raw)
    {
        var constant = Util.GetNumber(raw, "mVariablePowerConsumptionConstant", 0);
        var factor = Util.GetNumber(raw, "mVariablePowerConsumptionFactor", 1);
        if (constant == 0 && factor == 1)
        {
            return null;
        }
        return new VariablePower { Min = constant, Max = constant + factor };
    }

    /// <summary>Extracts a production recipe. Call only when IsBuildGunRecipe is false.</summary>
    public static Recipe ExtractRecipe(JsonElement raw, RecipeLookups lookups)
    {
        var className = Util.GetString(raw, "ClassName");
        var displayName = Util.GetString(raw, "mDisplayName");
        var craftTime = Util.GetNumber(raw, "mManufactoringDuration", 0);
        var producedInRaw = Util.GetString(raw, "mProducedIn");

        var producedInClasses = ClassRef.ExtractClassNames(producedInRaw)
            .Where(lookups.BuildingClasses.Contains)
            .ToList();
        var producedIn = producedInClasses
            .Select(cn => lookups.BuildingDisplay.GetValueOrDefault(cn, cn))
            .ToList();

        var recipe = new Recipe
        {
            ClassName = className,
            DisplayName = displayName,
            IsAlternate = IsAlternateRecipe(className, displayName),
            CraftTime = craftTime,
            Ingredients = Normalise.ParseItemAmountList(Util.GetString(raw, "mIngredients"))
                .Select(item => MapIngredient(item, craftTime, lookups)).ToList(),
            Products = Normalise.ParseItemAmountList(Util.GetString(raw, "mProduct"))
                .Select(item => MapIngredient(item, craftTime, lookups)).ToList(),
            ProducedIn = producedIn,
            ProducedInClasses = producedInClasses,
            InBuildGun = false,
            InWorkshop = producedInRaw.Contains("WorkBench", StringComparison.OrdinalIgnoreCase)
                || producedInRaw.Contains("Workshop", StringComparison.OrdinalIgnoreCase),
        };

        recipe.VariablePower = ResolveVariablePower(raw);
        return recipe;
    }

    /// <summary>
    /// Resolves a build-gun recipe to the building it constructs via the name
    /// heuristic: product Desc_X_C → building Build_X_C. Returns null when empty.
    /// </summary>
    public static BuildRecipe? ExtractBuildRecipe(JsonElement raw)
    {
        var products = Normalise.ParseItemAmountList(Util.GetString(raw, "mProduct"));
        if (products.Count == 0)
        {
            return null;
        }
        var product = products[0];
        var buildingClassName = product.ClassName.StartsWith("Desc_", StringComparison.Ordinal)
            ? "Build_" + product.ClassName["Desc_".Length..]
            : product.ClassName;
        var cost = Normalise.ParseItemAmountList(Util.GetString(raw, "mIngredients"))
            .Select(item => new BuildCostLine { ItemClassName = item.ClassName, Amount = item.Amount })
            .ToList();
        return new BuildRecipe { BuildingClassName = buildingClassName, Cost = cost };
    }
}
