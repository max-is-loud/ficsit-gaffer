/**
 * A small hand-wired save scene shaped like the adopted parser's output (the v4.1
 * tagged-property model), exercising every path in `buildSaveGraph`:
 *   constructor → belt → storage   (a conveyor chain, with symmetric connectors)
 *   coal generator ↔ pipeline      (a pipe link carrying mPipeNetworkID)
 *   generator + miner              (a pre-grouped power circuit)
 *   a belt connector → a missing actor (a dangling reference → a warning, not a throw)
 * Real `.sav` files are never used in unit tests — see `npm run inspect`.
 */
import { normaliseSave, type RawObject, type RawSave } from '@foreman/sf-save-data';

const LVL = 'Persistent_Level:PersistentLevel';

function ref(pathName: string): { levelName: string; pathName: string } {
  return { levelName: 'Persistent_Level', pathName };
}

function objectProp(pathName: string): unknown {
  return { type: 'ObjectProperty', value: ref(pathName) };
}

function intProp(value: number): unknown {
  return { type: 'IntProperty', value };
}

function refArrayProp(pathNames: string[]): unknown {
  return { type: 'ArrayProperty', values: pathNames.map(ref) };
}

function sortRules(rules: { itemClass: string; output: number }[]): unknown {
  return {
    type: 'ArrayProperty',
    values: rules.map(({ itemClass, output }) => ({
      type: 'SplitterSortRule',
      properties: {
        ItemClass: { type: 'ObjectProperty', value: ref(itemClass) },
        OutputIndex: { type: 'IntProperty', value: output },
      },
    })),
  };
}

function vec3(
  x: number,
  y: number,
  z: number,
): { translation: { x: number; y: number; z: number } } {
  return { translation: { x, y, z } };
}

function obj(
  typePath: string,
  instanceName: string,
  properties: Record<string, unknown> = {},
  transform?: { translation: { x: number; y: number; z: number } },
): RawObject {
  return {
    typePath,
    instanceName,
    type: 'SaveEntity',
    properties,
    ...(transform === undefined ? {} : { transform }),
  };
}

// Class type-paths (the clean form the save uses).
const T_CONSTRUCTOR =
  '/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C';
const T_BELT =
  '/Game/FactoryGame/Buildable/Factory/ConveyorBeltMk1/Build_ConveyorBeltMk1.Build_ConveyorBeltMk1_C';
const T_STORAGE =
  '/Game/FactoryGame/Buildable/Storage/Build_StorageContainerMk1.Build_StorageContainerMk1_C';
const T_GENERATOR =
  '/Game/FactoryGame/Buildable/Factory/GeneratorBiomass/Build_GeneratorBiomass_Automated.Build_GeneratorBiomass_Automated_C';
const T_MINER = '/Game/FactoryGame/Buildable/Factory/MinerMk2/Build_MinerMk2.Build_MinerMk2_C';
const T_COAL =
  '/Game/FactoryGame/Buildable/Factory/GeneratorCoal/Build_GeneratorCoal.Build_GeneratorCoal_C';
const T_PIPE =
  '/Game/FactoryGame/Buildable/Factory/Pipeline/Build_Pipeline_NoIndicator.Build_Pipeline_NoIndicator_C';
const T_SMART_SPLITTER =
  '/Game/FactoryGame/Buildable/Factory/CA_Splitter/Build_ConveyorAttachmentSplitterSmart.Build_ConveyorAttachmentSplitterSmart_C';
const T_FACTORY_CONN = '/Script/FactoryGame.FGFactoryConnectionComponent';
const T_PIPE_CONN = '/Script/FactoryGame.FGPipeConnectionFactory';
const T_POWER_CIRCUIT = '/Script/FactoryGame.FGPowerCircuit';

// Instance names of the actors (used by the tests).
export const CONSTRUCTOR = `${LVL}.Build_ConstructorMk1_C_1`;
export const BELT = `${LVL}.Build_ConveyorBeltMk1_C_1`;
export const STORAGE = `${LVL}.Build_StorageContainerMk1_C_1`;
export const GENERATOR = `${LVL}.Build_GeneratorBiomass_Automated_C_1`;
export const MINER = `${LVL}.Build_MinerMk2_C_1`;
export const COAL = `${LVL}.Build_GeneratorCoal_C_1`;
export const PIPE = `${LVL}.Build_Pipeline_NoIndicator_C_1`;
export const STRAY_BELT = `${LVL}.Build_ConveyorBeltMk1_C_2`;
export const SMART_SPLITTER = `${LVL}.Build_ConveyorAttachmentSplitterSmart_C_1`;

function makeSave(objects: RawObject[]): RawSave {
  return {
    header: { buildVersion: 999999, saveVersion: 60, sessionName: 'GraphFixture' },
    levels: { Persistent_Level: { name: 'Persistent_Level', objects } },
  };
}

/** A representative wired save exercising every `buildSaveGraph` path. */
export const SCENE: RawSave = makeSave([
  // Actors.
  obj(T_CONSTRUCTOR, CONSTRUCTOR, {}, vec3(100, 0, 0)),
  obj(T_BELT, BELT, {}, vec3(200, 0, 0)),
  obj(T_STORAGE, STORAGE, {}, vec3(300, 0, 0)),
  obj(T_GENERATOR, GENERATOR, {}, vec3(0, 100, 0)),
  obj(T_MINER, MINER, {}, vec3(0, 200, 0)),
  obj(T_COAL, COAL, {}, vec3(0, 300, 0)),
  obj(T_PIPE, PIPE, {}, vec3(0, 400, 0)),
  obj(T_BELT, STRAY_BELT, {}, vec3(0, 500, 0)),
  // A smart splitter carrying conditional routing rules (an item filter + overflow).
  obj(
    T_SMART_SPLITTER,
    SMART_SPLITTER,
    {
      mSortRules: sortRules([
        { itemClass: '/Game/FactoryGame/Resource/Parts/Wire/Desc_Wire.Desc_Wire_C', output: 0 },
        {
          itemClass: '/Game/FactoryGame/Resource/FilteringRules/Desc_Overflow.Desc_Overflow_C',
          output: 1,
        },
      ]),
    },
    vec3(0, 600, 0),
  ),

  // Conveyor chain: constructor.Output0 ↔ belt.ConveyorAny0, belt.ConveyorAny1 ↔ storage.Input0.
  // Both ends of each link declare it — the builder must dedup the symmetric pair.
  obj(T_FACTORY_CONN, `${CONSTRUCTOR}.Output0`, {
    mConnectedComponent: objectProp(`${BELT}.ConveyorAny0`),
  }),
  obj(T_FACTORY_CONN, `${BELT}.ConveyorAny0`, {
    mConnectedComponent: objectProp(`${CONSTRUCTOR}.Output0`),
  }),
  obj(T_FACTORY_CONN, `${BELT}.ConveyorAny1`, {
    mConnectedComponent: objectProp(`${STORAGE}.Input0`),
  }),
  obj(T_FACTORY_CONN, `${STORAGE}.Input0`, {
    mConnectedComponent: objectProp(`${BELT}.ConveyorAny1`),
  }),
  // An unconnected connector — common, and must be silently ignored (no edge, no warning).
  obj(T_FACTORY_CONN, `${CONSTRUCTOR}.Input0`, {}),
  // A dangling connector: its peer's owner actor does not exist → one summary warning.
  obj(T_FACTORY_CONN, `${STRAY_BELT}.ConveyorAny0`, {
    mConnectedComponent: objectProp(`${LVL}.Build_Ghost_C_999.Output0`),
  }),

  // Pipe link carrying a network id (symmetric, must dedup to one edge).
  obj(T_PIPE_CONN, `${COAL}.PipeInput0`, {
    mConnectedComponent: objectProp(`${PIPE}.PipelineConnection0`),
    mPipeNetworkID: intProp(4),
  }),
  obj(T_PIPE_CONN, `${PIPE}.PipelineConnection0`, {
    mConnectedComponent: objectProp(`${COAL}.PipeInput0`),
    mPipeNetworkID: intProp(4),
  }),

  // A pre-grouped power circuit: generator + miner.
  obj(T_POWER_CIRCUIT, `${LVL}.CircuitSubsystem.FGPowerCircuit_1`, {
    mCircuitID: intProp(3),
    mComponents: refArrayProp([`${GENERATOR}.PowerConnection`, `${MINER}.PowerInput`]),
  }),
]);

/**
 * The same scene as a normalised `SaveState` — the input the graph now projects
 * from. `buildSaveGraph` consumes `state.topology` (produced by the real
 * `sf-save-data` normaliser), so this exercises the full parse→normalise→project
 * path the MCP server uses.
 */
export const SCENE_STATE = normaliseSave(SCENE, '2026-01-01T00:00:00.000Z').state;
