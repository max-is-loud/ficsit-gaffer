// WorldQueries: read-only spatial lookups over the world-location dataset (biomes, collectibles,
// resource nodes, loot pickups), returning distances and display names rather than raw records.

import type { GameData } from '../parser/types.js';
import type {
  Biome,
  Collectible,
  CollectibleKind,
  Purity,
  ResourceNode,
  ResourceNodeKind,
  WorldLocations,
} from './types.js';

/** A point in the Satisfactory world, in Unreal units (centimetres). */
export interface Coord {
  x: number;
  y: number;
  z: number;
}

/** A resolved resource descriptor (class + display name). */
export interface ResourceRef {
  className: string;
  displayName: string;
}

export interface CollectibleHit extends Collectible {
  /** Straight-line distance from the query origin, in centimetres. */
  distance: number;
}

export interface ResourceNodeHit {
  id: string;
  kind: ResourceNodeKind;
  resource: ResourceRef | null;
  purity: Purity | null;
  x: number;
  y: number;
  z: number;
  distance: number;
}

export interface LootPickupHit {
  id: string;
  guid: string;
  /** The resolved item the pickup grants (class + display name). */
  item: ResourceRef;
  amount: number;
  x: number;
  y: number;
  z: number;
  distance: number;
}

/** Per-item summary of loose crash-site parts across the world. */
export interface PartSummary {
  item: ResourceRef;
  /** Number of pickups of this item. */
  pickups: number;
  /** Total quantity across all those pickups. */
  totalAmount: number;
}

const COLLECTIBLE_KINDS: readonly CollectibleKind[] = [
  'mercerSphere',
  'somersloop',
  'powerSlugBlue',
  'powerSlugYellow',
  'powerSlugPurple',
  'hardDrive',
  'helmet',
  'mtape',
];

function distance(origin: Coord, point: { x: number; y: number; z: number }): number {
  const dx = origin.x - point.x;
  const dy = origin.y - point.y;
  const dz = origin.z - point.z;
  return Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz));
}

/** The biome a world position resolves to (contained outright, or the nearest one). */
export interface BiomeHit {
  name: string;
  isStartingLocation: boolean;
  /** True when the point is inside the biome's polygon; false when snapped to the nearest biome. */
  contained: boolean;
  /** Distance (cm) to the biome — 0 when contained, else to its nearest edge. */
  distance: number;
  /** Centroid (cm) of the biome's largest polygon — useful for a within-biome bearing. */
  centroid: { x: number; y: number };
}

type Ring = [number, number][];
interface BiomeEntry {
  name: string;
  isStartingLocation: boolean;
  polygons: Ring[];
  area: number;
  centroid: { x: number; y: number };
}

/** Ray-casting point-in-ring test (2D, ignores z). */
function ringContains(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Absolute polygon area via the shoelace formula. */
function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j]![0] + ring[i]![0]) * (ring[j]![1] - ring[i]![1]);
  }
  return Math.abs(a) / 2;
}

function ringCentroid(ring: Ring): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return { x: sx / ring.length, y: sy / ring.length };
}

/** Shortest distance from a point to a ring's edges. */
function pointRingDistance(px: number, py: number, ring: Ring): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j]![0];
    const ay = ring[j]![1];
    const bx = ring[i]![0];
    const by = ring[i]![1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/**
 * Read-only queries over the static world-location dataset. Loaded straight
 * into memory (a flat point list + a distance sort beats the production graph
 * here), it answers "how many / where are the collectibles" and "what resource
 * nodes are near me". All answers are distilled — distances, display names and
 * purity, never raw instance-name dumps.
 */
export class WorldQueries {
  private readonly resourceNames = new Map<string, string>();
  /** Lazily-built `id → collectible` index for {@link resolveCollectibles}. */
  private collectibleById?: Map<string, Collectible>;
  /** Precomputed biome regions (rings + area + centroid) for {@link biomeAt}. */
  private readonly biomeIdx: BiomeEntry[];

  constructor(
    private readonly world: WorldLocations,
    gameData: GameData,
  ) {
    for (const item of [...Object.values(gameData.items), ...Object.values(gameData.resources)]) {
      this.resourceNames.set(item.className, item.displayName);
    }
    this.biomeIdx = (world.biomes ?? []).map((b: Biome) => {
      const rings = b.polygons.filter((r) => r.length >= 3);
      let area = 0;
      let biggest: Ring = rings[0] ?? [];
      for (const r of rings) {
        const a = ringArea(r);
        if (a > area) {
          area = a;
          biggest = r;
        }
      }
      return {
        name: b.name,
        isStartingLocation: b.isStartingLocation === true,
        polygons: rings,
        area,
        centroid: biggest.length > 0 ? ringCentroid(biggest) : { x: 0, y: 0 },
      };
    });
  }

  /** Every biome's name + start flag (no geometry) — for discovery. */
  public listBiomes(): { name: string; isStartingLocation: boolean }[] {
    return this.biomeIdx.map((e) => ({ name: e.name, isStartingLocation: e.isStartingLocation }));
  }

  /**
   * The biome a world position falls in. Returns the containing biome (the
   * smallest-area one if regions nest), else the nearest biome (so a point in a
   * thin coastal/border gap — or a cave under the surface — still resolves).
   * `null` only when no biomes are loaded.
   */
  public biomeAt(coord: Coord): BiomeHit | null {
    if (this.biomeIdx.length === 0) {
      return null;
    }
    const { x, y } = coord;
    let container: BiomeEntry | null = null;
    for (const e of this.biomeIdx) {
      if (e.polygons.some((r) => ringContains(x, y, r))) {
        if (container === null || e.area < container.area) {
          container = e;
        }
      }
    }
    if (container !== null) {
      return {
        name: container.name,
        isStartingLocation: container.isStartingLocation,
        contained: true,
        distance: 0,
        centroid: container.centroid,
      };
    }
    let nearest = this.biomeIdx[0]!;
    let best = Infinity;
    for (const e of this.biomeIdx) {
      for (const r of e.polygons) {
        const d = pointRingDistance(x, y, r);
        if (d < best) {
          best = d;
          nearest = e;
        }
      }
    }
    return {
      name: nearest.name,
      isStartingLocation: nearest.isStartingLocation,
      contained: false,
      distance: Math.round(best),
      centroid: nearest.centroid,
    };
  }

  private resolveResource(className: string | null): ResourceRef | null {
    if (className === null) {
      return null;
    }
    return {
      className,
      displayName: this.resourceNames.get(className) ?? '',
    };
  }

  /**
   * Counts per collectible kind, plus the full point list for a single kind when
   * `type` is supplied (omitted otherwise to avoid dumping the whole dataset).
   */
  public listCollectibles(type?: CollectibleKind): {
    counts: Partial<Record<CollectibleKind, number>>;
    total: number;
    collectibles?: Collectible[];
  } {
    const counts: Partial<Record<CollectibleKind, number>> = {};
    for (const kind of COLLECTIBLE_KINDS) {
      const n = this.world.counts[kind];
      if (n !== undefined) {
        counts[kind] = n;
      }
    }
    if (type === undefined) {
      const total = COLLECTIBLE_KINDS.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0);
      return { counts, total };
    }
    const collectibles = this.world.collectibles.filter((c) => c.kind === type);
    return { counts, total: collectibles.length, collectibles };
  }

  /**
   * Resolves collectibles by their stable `id` to their canonical world records — kind,
   * coordinates, identity (guid/schematic) and, for hard-drive pods, the `unlock` cost. Lets
   * an explore order be accurate-by-construction: the server derives each waypoint
   * collectible's facts (never trusting a transcribed unlock cost) and reports any `id` that
   * is not a known collectible so the order can be rejected.
   */
  public resolveCollectibles(ids: string[]): { resolved: Collectible[]; unresolved: string[] } {
    if (this.collectibleById === undefined) {
      this.collectibleById = new Map(this.world.collectibles.map((c) => [c.id, c]));
    }
    const resolved: Collectible[] = [];
    const unresolved: string[] = [];
    for (const id of ids) {
      const c = this.collectibleById.get(id);
      if (c === undefined) {
        unresolved.push(id);
      } else {
        resolved.push(c);
      }
    }
    return { resolved, unresolved };
  }

  /** The `n` collectibles nearest a world location, optionally filtered by kind. */
  public nearestCollectibles(origin: Coord, type?: CollectibleKind, n = 10): CollectibleHit[] {
    const pool =
      type === undefined
        ? this.world.collectibles
        : this.world.collectibles.filter((c) => c.kind === type);
    return pool
      .map((c) => ({ ...c, distance: distance(origin, c) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.max(0, n));
  }

  /**
   * The `n` resource nodes nearest a world location, optionally filtered by
   * resource (matched against class or display name) and purity.
   */
  public nearestResourceNodes(
    origin: Coord,
    opts: { resource?: string; purity?: Purity; n?: number } = {},
  ): ResourceNodeHit[] {
    const { resource, purity, n = 10 } = opts;
    const needle = resource?.trim().toLowerCase();
    const pool = this.world.resourceNodes.filter((node) => {
      if (purity !== undefined && node.purity !== purity) {
        return false;
      }
      if (needle !== undefined && needle !== '') {
        const ref = this.resolveResource(node.resourceClass);
        if (ref === null) {
          return false;
        }
        if (
          !ref.className.toLowerCase().includes(needle) &&
          !ref.displayName.toLowerCase().includes(needle)
        ) {
          return false;
        }
      }
      return true;
    });
    return pool
      .map((node) => this.toHit(node, distance(origin, node)))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.max(0, n));
  }

  /** Resolve an item descriptor class to a display name (never null — items always have a class). */
  private resolveItem(className: string): ResourceRef {
    return {
      className,
      displayName: this.resourceNames.get(className) ?? '',
    };
  }

  /**
   * Per-item summary of every loose crash-site part in the world, optionally filtered
   * to items matching `item` (by class or display name). Sorted by pickup count.
   */
  public listParts(item?: string): { byItem: PartSummary[]; totalPickups: number } {
    const needle = item?.trim().toLowerCase();
    const acc = new Map<string, { pickups: number; totalAmount: number }>();
    for (const p of this.world.lootPickups) {
      const ref = this.resolveItem(p.itemClass);
      if (
        needle !== undefined &&
        needle !== '' &&
        !ref.className.toLowerCase().includes(needle) &&
        !ref.displayName.toLowerCase().includes(needle)
      ) {
        continue;
      }
      const cur = acc.get(p.itemClass) ?? { pickups: 0, totalAmount: 0 };
      cur.pickups += 1;
      cur.totalAmount += p.amount;
      acc.set(p.itemClass, cur);
    }
    const byItem = [...acc.entries()]
      .map(([className, v]) => ({ item: this.resolveItem(className), ...v }))
      .sort((a, b) => b.pickups - a.pickups);
    return { byItem, totalPickups: byItem.reduce((s, x) => s + x.pickups, 0) };
  }

  /**
   * The `n` loose crash-site parts nearest a world location, nearest-first, optionally
   * filtered to items matching `item` (by class or display name). Each carries the
   * resolved item, amount, and straight-line distance.
   */
  public nearestParts(origin: Coord, item?: string, n = 10): LootPickupHit[] {
    const needle = item?.trim().toLowerCase();
    const pool = this.world.lootPickups.filter((p) => {
      if (needle === undefined || needle === '') {
        return true;
      }
      const ref = this.resolveItem(p.itemClass);
      return (
        ref.className.toLowerCase().includes(needle) ||
        ref.displayName.toLowerCase().includes(needle)
      );
    });
    return pool
      .map((p) => ({
        id: p.id,
        guid: p.guid,
        item: this.resolveItem(p.itemClass),
        amount: p.amount,
        x: p.x,
        y: p.y,
        z: p.z,
        distance: distance(origin, p),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, Math.max(0, n));
  }

  private toHit(node: ResourceNode, dist: number): ResourceNodeHit {
    return {
      id: node.id,
      kind: node.kind,
      resource: this.resolveResource(node.resourceClass),
      purity: node.purity,
      x: node.x,
      y: node.y,
      z: node.z,
      distance: dist,
    };
  }
}
