import { describe, expect, it } from 'vitest';

import { emptySaveState, normaliseSave } from '@foreman/sf-save-data';

import { buildSaveGraph, ownerOf } from '../src/index.js';
import { makeSave, obj, objectProp, vec3 } from '../../sf-save-data/test/fixtures/save.js';
import {
  BELT,
  CONSTRUCTOR,
  COAL,
  GENERATOR,
  MINER,
  PIPE,
  SCENE_STATE,
  SMART_SPLITTER,
  STORAGE,
} from './fixtures/scene.js';

describe('ownerOf', () => {
  it('drops the trailing connector segment', () => {
    expect(ownerOf(`${CONSTRUCTOR}.Output0`)).toBe(CONSTRUCTOR);
  });

  it('returns the path unchanged when there is no segment', () => {
    expect(ownerOf('NoDots')).toBe('NoDots');
  });
});

describe('buildSaveGraph', () => {
  const graph = buildSaveGraph(SCENE_STATE);

  it('registers only building actors (not connection components or circuits)', () => {
    const stats = graph.stats();
    // 9 Build_* actors in the scene; connectors/circuits are not actor nodes.
    expect(stats.actors).toBe(9);
    expect(graph.getActor(CONSTRUCTOR)?.classKey).toBe('Build_ConstructorMk1_C');
    expect(graph.getActor(`${CONSTRUCTOR}.Output0`)).toBeUndefined();
  });

  it('carries actor locations through', () => {
    expect(graph.getActor(CONSTRUCTOR)?.location).toEqual({ x: 100, y: 0, z: 0 });
  });

  it('resolves conveyor links to owner actors and dedups the symmetric pair', () => {
    const conveyor = graph.edges('conveyor');
    // constructor↔belt and belt↔storage (each declared from both ends, deduped to
    // one), plus the dangling stray-belt link (recorded, but warned — see below).
    expect(conveyor).toHaveLength(3);
    const pairs = conveyor.map((e) => [e.from, e.to].sort());
    expect(pairs).toContainEqual([BELT, CONSTRUCTOR].sort());
    expect(pairs).toContainEqual([BELT, STORAGE].sort());
  });

  it('retains connector name tails for direction inference', () => {
    const edge = graph
      .edges('conveyor')
      .find((e) => e.from === CONSTRUCTOR || e.to === CONSTRUCTOR);
    const connectors = [edge?.fromConnector, edge?.toConnector];
    expect(connectors).toContain('Output0');
    expect(connectors).toContain('ConveyorAny0');
  });

  it('models belts as nodes so a chain is traversable end to end', () => {
    expect(
      graph
        .neighbours(BELT, 'conveyor')
        .map((a) => a.instanceName)
        .sort(),
    ).toEqual([CONSTRUCTOR, STORAGE].sort());
    // Constructor reaches storage only by passing through the belt node.
    expect(graph.traverse(CONSTRUCTOR, { kind: 'conveyor' })).toContain(STORAGE);
    expect(graph.traverse(CONSTRUCTOR, { kind: 'conveyor', maxDepth: 1 })).not.toContain(STORAGE);
  });

  it('resolves pipe links and carries the network id', () => {
    const pipes = graph.edges('pipe');
    expect(pipes).toHaveLength(1);
    expect(pipes[0]?.networkId).toBe(4);
    expect([pipes[0]?.from, pipes[0]?.to].sort()).toEqual([COAL, PIPE].sort());
  });

  it('reads pre-grouped power circuits and maps members to circuits', () => {
    const circuits = graph.powerCircuits();
    expect(circuits).toHaveLength(1);
    expect(circuits[0]?.circuitId).toBe(3);
    expect(circuits[0]?.members.sort()).toEqual([GENERATOR, MINER].sort());
    expect(graph.powerCircuitOf(GENERATOR)?.circuitId).toBe(3);
    expect(graph.powerCircuitOf(CONSTRUCTOR)).toBeUndefined();
  });

  it('surfaces the save warnings (e.g. a dangling connection reference)', () => {
    // The unresolved-reference warning is produced by the normaliser and projected
    // through unchanged — the graph generates none of its own.
    expect(graph.warnings.some((w) => /conveyor connection.*unknown owner/.test(w))).toBe(true);
  });

  it('never throws on an empty or partial state', () => {
    const empty = emptySaveState('unknown', 'none', '2026-01-01T00:00:00.000Z');
    expect(() => buildSaveGraph(empty)).not.toThrow();
    expect(buildSaveGraph(empty).stats().actors).toBe(0);
    // A malformed state missing topology must not throw either.
    expect(() => buildSaveGraph({ warnings: [] } as never).stats()).not.toThrow();
  });
});

describe('domain projection (nodes carry their typed save records)', () => {
  const graph = buildSaveGraph(SCENE_STATE);

  it('tags each actor with its domain role, joined by instance name', () => {
    expect(graph.getActor(CONSTRUCTOR)?.kind).toBe('producer');
    expect(graph.getActor(MINER)?.kind).toBe('extractor');
    expect(graph.getActor(STORAGE)?.kind).toBe('storage');
    expect(graph.getActor(GENERATOR)?.kind).toBe('generator');
    expect(graph.getActor(COAL)?.kind).toBe('generator');
    expect(graph.getActor(BELT)?.kind).toBe('building'); // no domain record
  });

  it('attaches the matching typed record to the node', () => {
    expect(graph.getActor(STORAGE)?.storage?.instanceName).toBe(STORAGE);
    expect(graph.getActor(MINER)?.extractor?.instanceName).toBe(MINER);
    expect(graph.getActor(GENERATOR)?.generator?.instanceName).toBe(GENERATOR);
    const producer = graph.getActor(CONSTRUCTOR)?.producer;
    expect(producer?.instanceName).toBe(CONSTRUCTOR);
    expect(producer?.buildingClass).toBe('Build_ConstructorMk1_C');
  });

  it('selects actors by domain role', () => {
    expect(graph.actorsByKind('extractor').map((a) => a.instanceName)).toEqual([MINER]);
    expect(graph.actorsByKind('storage').map((a) => a.instanceName)).toEqual([STORAGE]);
    expect(
      graph
        .actorsByKind('generator')
        .map((a) => a.instanceName)
        .sort(),
    ).toEqual([COAL, GENERATOR].sort());
  });

  it('exposes the backing SaveState so every save fact is reachable from the graph', () => {
    expect(graph.state()).toBe(SCENE_STATE);
    expect(graph.state().topology.buildables).toHaveLength(graph.stats().actors);
  });

  it('projects smart-splitter routing rules onto the node and via splitterRulesOf', () => {
    const node = graph.getActor(SMART_SPLITTER);
    expect(node?.kind).toBe('building'); // a splitter carries no domain record
    expect(node?.splitter?.classKey).toBe('Build_ConveyorAttachmentSplitterSmart_C');
    expect(graph.splitterRulesOf(SMART_SPLITTER)).toEqual([
      { outputIndex: 0, rule: 'item', itemClass: 'Desc_Wire_C' },
      { outputIndex: 1, rule: 'overflow' },
    ]);
  });

  it('returns undefined splitter rules for non-splitter actors', () => {
    expect(graph.splitterRulesOf(CONSTRUCTOR)).toBeUndefined();
    expect(graph.getActor(CONSTRUCTOR)?.splitter).toBeUndefined();
  });
});

describe('directed-flow inference (feed-tracing substrate)', () => {
  const graph = buildSaveGraph(SCENE_STATE);

  it('orients a machine→belt→machine chain from connectors and propagates through the belt', () => {
    // constructor.Output0 → belt.ConveyorAny0 (certain) and belt.ConveyorAny1 →
    // storage.Input0 (certain): the belt itself carries no directional connector but is
    // oriented by propagation, so storage traces all the way back to the constructor.
    const up = graph.upstreamOf(STORAGE);
    expect(up.actors.sort()).toEqual([BELT, CONSTRUCTOR].sort());
    expect(up.complete).toBe(true);

    const down = graph.downstreamOf(CONSTRUCTOR);
    expect(down.actors.sort()).toEqual([BELT, STORAGE].sort());
    expect(down.complete).toBe(true);
  });

  it('orients a pipe link from the Input connector', () => {
    // coal.PipeInput0 ↔ pipe.PipelineConnection0: the Input end fixes flow as pipe→coal.
    expect(graph.upstreamOf(COAL).actors).toContain(PIPE);
    expect(graph.downstreamOf(PIPE).actors).toContain(COAL);
  });

  it('reports nothing upstream of a true source, completely', () => {
    const up = graph.upstreamOf(CONSTRUCTOR);
    expect(up.actors).toEqual([]);
    expect(up.complete).toBe(true);
  });

  it('respects the depth bound, flagging the result incomplete when truncated', () => {
    const up = graph.upstreamOf(STORAGE, { maxDepth: 1 });
    expect(up.actors).toEqual([BELT]); // only one hop; the constructor is two away
    expect(up.complete).toBe(false);
  });

  it('propagates direction through an ambiguous belt→belt link (not just certain ends)', () => {
    // A genuine ConveyorAny↔ConveyorAny middle edge (belt1↔belt2) carries no directional
    // connector, so only forward propagation from the source can orient it. The source's
    // output and the sink's input are the only certain edges.
    const LVL = 'Persistent_Level:PersistentLevel';
    const A = `${LVL}.Build_ConstructorMk1_C_1`;
    const B1 = `${LVL}.Build_ConveyorBeltMk1_C_1`;
    const B2 = `${LVL}.Build_ConveyorBeltMk1_C_2`;
    const ST = `${LVL}.Build_StorageContainerMk1_C_1`;
    const T_CONN = '/Script/FactoryGame.FGFactoryConnectionComponent';
    const link = (owner: string, conn: string, peer: string) =>
      obj(T_CONN, { mConnectedComponent: objectProp(peer) }, { instanceName: `${owner}.${conn}` });
    const state = normaliseSave(
      makeSave({
        objects: [
          obj(
            '/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C',
            {},
            { instanceName: A, transform: vec3(0, 0, 0) },
          ),
          obj(
            '/Game/FactoryGame/Buildable/Factory/ConveyorBeltMk1/Build_ConveyorBeltMk1.Build_ConveyorBeltMk1_C',
            {},
            { instanceName: B1, transform: vec3(1, 0, 0) },
          ),
          obj(
            '/Game/FactoryGame/Buildable/Factory/ConveyorBeltMk1/Build_ConveyorBeltMk1.Build_ConveyorBeltMk1_C',
            {},
            { instanceName: B2, transform: vec3(2, 0, 0) },
          ),
          obj(
            '/Game/FactoryGame/Buildable/Storage/Build_StorageContainerMk1.Build_StorageContainerMk1_C',
            {},
            { instanceName: ST, transform: vec3(3, 0, 0) },
          ),
          link(A, 'Output0', `${B1}.ConveyorAny0`),
          link(B1, 'ConveyorAny0', `${A}.Output0`),
          link(B1, 'ConveyorAny1', `${B2}.ConveyorAny0`), // ambiguous middle edge
          link(B2, 'ConveyorAny0', `${B1}.ConveyorAny1`),
          link(B2, 'ConveyorAny1', `${ST}.Input0`),
          link(ST, 'Input0', `${B2}.ConveyorAny1`),
        ],
      }),
      '2026-01-01T00:00:00.000Z',
    ).state;
    const g = buildSaveGraph(state);
    const up = g.upstreamOf(ST);
    expect(up.actors.sort()).toEqual([A, B1, B2].sort());
    expect(up.complete).toBe(true);
  });

  it('filters reach by edge kind so an ambiguous pipe does not pollute the belt feed', () => {
    // A machine with no belt feed (so it is not a propagation seed) wired to an ambiguous pipe
    // (PipelineConnection both ends → unresolvable) — exactly the case where pipe ambiguity used to
    // make a belt-fed producer read `unknown`. The all-kinds reach is incomplete; conveyor-only is not.
    const LVL = 'Persistent_Level:PersistentLevel';
    const M = `${LVL}.Build_AssemblerMk1_C_1`;
    const PIPE2 = `${LVL}.Build_Pipeline_C_1`;
    const T_PC = '/Script/FactoryGame.FGPipeConnectionFactory';
    const c = (owner: string, conn: string, peer: string) =>
      obj(T_PC, { mConnectedComponent: objectProp(peer) }, { instanceName: `${owner}.${conn}` });
    const state = normaliseSave(
      makeSave({
        objects: [
          obj(
            '/Game/FactoryGame/Buildable/Factory/AssemblerMk1/Build_AssemblerMk1.Build_AssemblerMk1_C',
            {},
            { instanceName: M, transform: vec3(0, 0, 0) },
          ),
          obj(
            '/Game/FactoryGame/Buildable/Factory/Pipeline/Build_Pipeline.Build_Pipeline_C',
            {},
            { instanceName: PIPE2, transform: vec3(1, 0, 0) },
          ),
          // Ambiguous pipe edge (PipelineConnection both ends, no source seed → stays unresolved).
          c(M, 'PipelineConnection0', `${PIPE2}.PipelineConnection0`),
          c(PIPE2, 'PipelineConnection0', `${M}.PipelineConnection0`),
        ],
      }),
      '2026-01-01T00:00:00.000Z',
    ).state;
    const g = buildSaveGraph(state);
    expect(g.upstreamOf(M).complete).toBe(false); // all kinds: the ambiguous pipe pollutes it
    expect(g.upstreamOf(M, { kind: 'conveyor' }).complete).toBe(true); // conveyor-only: no unresolved belt
    expect(g.upstreamOf(M, { kind: 'pipe' }).complete).toBe(false); // pipe-only is still ambiguous
  });
});
