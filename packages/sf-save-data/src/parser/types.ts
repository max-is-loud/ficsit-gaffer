/**
 * The minimal structural view of the adopted parser's output that the rest of
 * this package relies on. The library exposes a far richer model; we deliberately
 * describe only what `normalise/` reads, so the tools never import library types
 * directly and a future parser swap is contained to `parser/index.ts`.
 *
 * Confirmed against real saves (parser `@etothepii/satisfactory-file-parser` v4.1).
 * Property values use the library's tagged shape and are read defensively via
 * the getters in `normalise/util.ts` — hence `properties` is left as `unknown`.
 */

export interface RawVector {
  x: number;
  y: number;
  z: number;
}

export interface RawTransform {
  translation?: RawVector;
}

/** A reference to another object (`{ levelName, pathName }`). */
export interface RawObjectReference {
  levelName?: string;
  pathName: string;
}

export interface RawObject {
  typePath?: string;
  instanceName?: string;
  type?: string;
  transform?: RawTransform;
  components?: RawObjectReference[];
  /** Tagged-property bag — keyed by property name; read via normalise/util getters. */
  properties?: unknown;
}

export interface RawLevel {
  name?: string;
  objects?: RawObject[];
  /** Per-level registry of collected (destroyed) actor references. */
  collectables?: RawObjectReference[];
}

export interface RawHeader {
  saveVersion?: number;
  buildVersion?: number;
  saveHeaderType?: number;
  sessionName?: string;
  saveName?: string;
  mapName?: string;
  playDurationSeconds?: number;
  /** When the game wrote the save, as unix milliseconds in a string ("0" when unrecorded). */
  saveDateTime?: string;
  /** Whether Creative Mode is enabled for this save — the authoritative creative flag (#172). */
  creativeModeEnabled?: boolean;
}

export interface RawSave {
  header?: RawHeader;
  /** Levels are a name→level map (the save is split across World-Partition cells). */
  levels?: Record<string, RawLevel>;
}
