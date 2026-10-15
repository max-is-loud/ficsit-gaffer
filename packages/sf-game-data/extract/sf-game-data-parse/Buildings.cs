// Builds Building records from raw docs classes: power consumption and production, generator fuels
// with per-minute consumption, and belt, pipe, pump and extractor throughput. Build costs are
// attached later by GameDataParser from the build-gun recipes.

using System.Text.Json;

namespace SfGameData.Parse;

// Ported from src/parser/extractors/buildings.ts.
public static class Buildings
{
    private static string UnitFor(Item? item)
        => item is not null && item.Form is "liquid" or "gas" ? "m³" : "items";

    private static string DisplayFor(Item? item) => item?.DisplayName ?? "";

    // Fuel consumed per minute: items/min = power·60 ÷ energy. Fluid energy is per
    // unit (1000 units = 1 m³), so an extra ÷1000 yields m³/min.
    private static double FuelRatePerMinute(double powerProduction, Item? item)
    {
        if (item is null || item.EnergyValue <= 0)
        {
            return 0;
        }
        var perUnit = powerProduction * 60 / item.EnergyValue;
        return UnitFor(item) == "m³" ? perUnit / 1000 : perUnit;
    }

    private static FuelFlow Flow(string className, Item? item, double perMinute) => new()
    {
        ItemClassName = className,
        DisplayName = DisplayFor(item),
        PerMinute = perMinute,
        Unit = UnitFor(item),
    };

    private static List<GeneratorFuel>? ComputeFuels(
        JsonElement rawFuel,
        double powerProduction,
        double supplementalRatio,
        Dictionary<string, Item> items)
    {
        if (rawFuel.ValueKind != JsonValueKind.Array)
        {
            return null;
        }
        var fuels = new List<GeneratorFuel>();
        foreach (var entry in rawFuel.EnumerateArray())
        {
            if (!Util.IsRecord(entry))
            {
                continue;
            }
            var fuelClass = Util.GetString(entry, "mFuelClass");
            if (fuelClass == "")
            {
                continue;
            }
            var fuelItem = items.GetValueOrDefault(fuelClass);
            var fuelRate = FuelRatePerMinute(powerProduction, fuelItem);
            var result = new GeneratorFuel { Fuel = Flow(fuelClass, fuelItem, fuelRate) };

            var supplementalClass = Util.GetString(entry, "mSupplementalResourceClass");
            if (supplementalClass != "" && supplementalRatio > 0 && powerProduction > 0)
            {
                var supplementalItem = items.GetValueOrDefault(supplementalClass);
                var ratePerMinute = powerProduction * supplementalRatio * 60 / 1000;
                result.Supplemental = Flow(supplementalClass, supplementalItem, ratePerMinute);
            }

            var byproductClass = Util.GetString(entry, "mByproduct");
            var byproductAmount = Util.GetNumber(entry, "mByproductAmount", 0);
            if (byproductClass != "" && byproductAmount > 0)
            {
                var byproductItem = items.GetValueOrDefault(byproductClass);
                result.Byproduct = Flow(byproductClass, byproductItem, fuelRate * byproductAmount);
            }

            fuels.Add(result);
        }
        return fuels.Count > 0 ? fuels : null;
    }

    public static Building BuildingFromRaw(JsonElement raw, string shortName, Dictionary<string, Item> items)
    {
        var category = shortName;
        if (category.StartsWith("FGBuildable", StringComparison.Ordinal))
        {
            category = category["FGBuildable".Length..];
        }
        if (category.StartsWith("FGBuilding", StringComparison.Ordinal))
        {
            category = category["FGBuilding".Length..];
        }
        if (category.Length == 0)
        {
            category = "Building";
        }

        var building = new Building
        {
            ClassName = Util.GetString(raw, "ClassName"),
            DisplayName = Util.GetString(raw, "mDisplayName"),
            Description = Util.GetString(raw, "mDescription"),
            Category = category,
            PowerConsumption = Util.GetNumber(raw, "mPowerConsumption", 0),
            BuildCost = [],
        };

        var maxPower = Util.GetNumber(raw, "mEstimatedMaximumPowerConsumption", 0);
        if (maxPower > 0)
        {
            building.MaxPowerConsumption = maxPower;
        }

        var conveyorSpeed = Util.GetNumber(raw, "mSpeed", 0); // belts: units are 2× items/min
        if (conveyorSpeed > 0)
        {
            building.ConveyorSpeedPerMin = conveyorSpeed / 2;
        }
        var flowLimit = Util.GetNumber(raw, "mFlowLimit", 0); // pipes: m³/s
        if (flowLimit > 0)
        {
            building.PipeFlowPerMin = flowLimit * 60;
        }
        var headLift = Util.GetNumber(raw, "mDesignPressure", 0); // pumps: design head lift in metres
        if (headLift > 0)
        {
            building.HeadLiftMetres = headLift;
        }
        var itemsPerCycle = Util.GetNumber(raw, "mItemsPerCycle", 0); // miners / extractors
        var cycleTime = Util.GetNumber(raw, "mExtractCycleTime", 0);
        if (itemsPerCycle > 0 && cycleTime > 0)
        {
            var perMin = itemsPerCycle * 60 / cycleTime;
            var isLiquid = Util.GetString(raw, "mAllowedResourceForms").Contains("RF_LIQUID", StringComparison.Ordinal);
            building.ExtractionRatePerMin = isLiquid ? perMin / 1000 : perMin;
        }

        if (shortName.Contains("Generator", StringComparison.Ordinal))
        {
            var powerProduction = Util.GetNumber(raw, "mPowerProduction", 0);
            var variableFactor = Util.GetNumber(raw, "mVariablePowerProductionFactor", 0);
            if (powerProduction > 0)
            {
                building.PowerProduction = powerProduction;
            }
            else if (variableFactor > 0)
            {
                building.VariablePowerProduction = true;
            }
            var supplementalRatio = Util.GetNumber(raw, "mSupplementalToPowerRatio", 0);
            var fuels = ComputeFuels(Util.GetElement(raw, "mFuel"), powerProduction, supplementalRatio, items);
            if (fuels is not null)
            {
                building.Fuels = fuels;
            }
        }

        return building;
    }
}
