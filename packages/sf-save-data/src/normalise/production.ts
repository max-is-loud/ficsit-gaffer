// Extracts the factory floor from a save: recipe-running machines, resource extractors, power
// generators and batteries, as configuration only. Rates and power figures are derived elsewhere.

import {
  CLOCK_SPEED_PROP,
  CURRENT_FUEL_PROP,
  CURRENT_RECIPE_PROP,
  EXTRACTOR_BUILDING,
  GENERATOR_BUILDING,
  MANUFACTURER_BUILDING,
  POWER_STORAGE_BUILDING,
  POWER_STORE_PROP,
  PRODUCTION_BOOST_PROP,
} from '../constants.js';
import type { RawObject } from '../parser/types.js';
import { classNameFromPath } from './classRef.js';
import type {
  BatteryLine,
  ExtractorLine,
  GeneratorLine,
  ProducerLine,
  ProductionState,
} from './types.js';
import { numberField, propMap, refField, translation, type Warnings } from './util.js';

/**
 * Extracts the factory floor: recipe-running machines (Constructor → Manufacturer,
 * Refinery, Blender, …), resource extractors (miners / pumps / fracking) and power
 * generators (biomass / coal / fuel / nuclear / geothermal). Each record captures the
 * machine's *configuration* — building class, recipe/fuel class, clock speed and
 * somersloop boost — with no game-data join. Theoretical rates, MW capacity and
 * estimated power draw are derived later in the query layer (which has the recipe +
 * building game data). Never throws; an unconfigured machine (no `mCurrentRecipe`)
 * is still reported, with a warning.
 *
 * Clock speed and the sloop boost are saved only when not at their default, so an
 * absent property means 100% / no boost (→ default to 1). Whether a machine is
 * actually fed or powered is out of scope (see the actual-production graph issue).
 */
export function extractProduction(objects: RawObject[], warnings: Warnings): ProductionState {
  const producers: ProducerLine[] = [];
  const extractors: ExtractorLine[] = [];
  const generators: GeneratorLine[] = [];
  const batteries: BatteryLine[] = [];

  for (const obj of objects) {
    const typePath = obj.typePath ?? '';
    const isManufacturer = MANUFACTURER_BUILDING.test(typePath);
    const isExtractor = !isManufacturer && EXTRACTOR_BUILDING.test(typePath);
    const isGenerator = !isManufacturer && !isExtractor && GENERATOR_BUILDING.test(typePath);
    const isBattery =
      !isManufacturer && !isExtractor && !isGenerator && POWER_STORAGE_BUILDING.test(typePath);
    if (!isManufacturer && !isExtractor && !isGenerator && !isBattery) {
      continue;
    }
    const props = propMap(obj);
    const buildingClass = classNameFromPath(typePath || (obj.instanceName ?? ''));
    const instanceName = obj.instanceName;
    if (instanceName === undefined) {
      // A machine with no instance name can't be a graph node nor be joined to topology.
      warnings.add(`Machine ${buildingClass} has no instance name; skipping.`);
      continue;
    }

    if (isManufacturer) {
      const recipeRef = refField(props, CURRENT_RECIPE_PROP);
      const recipeClass = recipeRef === undefined ? undefined : classNameFromPath(recipeRef);
      if (recipeClass === undefined) {
        warnings.add(`Manufacturer ${buildingClass} has no configured recipe; reporting as idle.`);
      }
      producers.push({
        instanceName,
        buildingClass,
        recipeClass,
        clockSpeed: numberField(props, CLOCK_SPEED_PROP) ?? 1,
        productionBoost: numberField(props, PRODUCTION_BOOST_PROP) ?? 1,
        location: translation(obj),
      });
    } else if (isExtractor) {
      extractors.push({
        instanceName,
        buildingClass,
        clockSpeed: numberField(props, CLOCK_SPEED_PROP) ?? 1,
        productionBoost: numberField(props, PRODUCTION_BOOST_PROP) ?? 1,
        location: translation(obj),
      });
    } else if (isGenerator) {
      // Generator: burns fuel, no recipe/somersloop. `mCurrentFuelClass` is the item
      // loaded now (absent for geothermal / unfuelled). MW capacity is a game-data join.
      const fuelRef = refField(props, CURRENT_FUEL_PROP);
      const fuelClass = fuelRef === undefined ? undefined : classNameFromPath(fuelRef);
      generators.push({
        instanceName,
        buildingClass,
        clockSpeed: numberField(props, CLOCK_SPEED_PROP) ?? 1,
        ...(fuelClass === undefined ? {} : { fuelClass }),
        location: translation(obj),
      });
    } else {
      // Power Storage (battery): buffers the circuit. `mPowerStore` is its stored energy,
      // saved only when non-empty (→ default 0). Capacity (MWh) is a game-data join.
      batteries.push({
        instanceName,
        buildingClass,
        chargeMWh: numberField(props, POWER_STORE_PROP) ?? 0,
        location: translation(obj),
      });
    }
  }

  return { producers, extractors, generators, batteries };
}
