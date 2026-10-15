// Maps the NativeClass names in the docs file to the Category (item, resource, recipe, building,
// schematic) that decides which extractor handles each raw class.

using System.Text.RegularExpressions;

namespace SfGameData.Parse;

// Ported from @foreman/sf-game-data/src/parser/classMap.ts. Maps a NativeClass
// short name to an internal category; unrecognised classes return null and are
// skipped with a single aggregated warning by the caller.
public enum Category
{
    Item,
    Resource,
    Recipe,
    Building,
    Schematic,
}

public static partial class ClassMap
{
    // Item descriptor classes (parts, equipment, weapons, ammo, vehicles — all
    // craftable recipe products, so all treated as items).
    private static readonly HashSet<string> ItemClasses =
    [
        "FGItemDescriptor",
        "FGItemDescriptorBiomass",
        "FGItemDescriptorNuclearFuel",
        "FGItemDescriptorPowerBoosterFuel",
        "FGConsumableDescriptor",
        "FGConsumableEquipment",
        "FGEquipmentDescriptor",
        "FGPowerShardDescriptor",
        "FGAmmoTypeProjectile",
        "FGAmmoTypeInstantHit",
        "FGAmmoTypeSpreadshot",
        "FGVehicleDescriptor",
        "FGWeapon",
        "FGChargedWeapon",
        "FGEquipmentStunSpear",
        "FGChainsaw",
        "FGGasMask",
        "FGSuitBase",
        "FGJetPack",
        "FGHoverPack",
        "FGParachute",
        "FGJumpingStilts",
        "FGEquipmentZipline",
        "FGObjectScanner",
        "FGPortableMinerDispenser",
        "FGGolfCartDispenser",
    ];

    [GeneratedRegex(@"\.([A-Za-z0-9_]+)'$")]
    private static partial Regex ShortName();

    /// <summary>
    /// Extracts the short class name from a NativeClass string, e.g.
    /// <c>Class'/Script/FactoryGame.FGRecipe'</c> → <c>FGRecipe</c>.
    /// </summary>
    public static string ShortNameFromNativeClass(string nativeClass)
    {
        var match = ShortName().Match(nativeClass);
        return match.Success ? match.Groups[1].Value : nativeClass;
    }

    public static Category? CategoryFor(string shortName)
    {
        if (shortName == "FGRecipe")
        {
            return Category.Recipe;
        }
        if (shortName == "FGSchematic")
        {
            return Category.Schematic;
        }
        if (shortName == "FGResourceDescriptor")
        {
            return Category.Resource;
        }
        if (ItemClasses.Contains(shortName))
        {
            return Category.Item;
        }
        if (shortName.StartsWith("FGBuildable", StringComparison.Ordinal)
            || shortName.StartsWith("FGBuilding", StringComparison.Ordinal))
        {
            return Category.Building;
        }
        return null;
    }
}
