// Defensive readers for the parser's tagged-property shapes (scalars, structs, references, arrays,
// translations) and the Warnings collector shared by every normaliser.

import type { RawObject, RawVector } from '../parser/types.js';
import type { Vec3 } from './types.js';

/** Collects non-fatal normalisation issues without throwing. */
export class Warnings {
  private readonly messages: string[] = [];

  public add(message: string): void {
    this.messages.push(message);
  }

  public all(): string[] {
    return [...this.messages];
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Walks nested record keys, returning undefined if any step is missing. */
export function dig(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

/**
 * Normalises a tagged-property bag to a `name → wrapper` map. The parser exposes
 * properties as either an object keyed by name or an array of `{ name, ... }`
 * wrappers; both are handled here so callers don't care which.
 */
export function toPropMap(properties: unknown): Record<string, unknown> {
  if (Array.isArray(properties)) {
    const map: Record<string, unknown> = {};
    for (const item of properties) {
      const name = asString(dig(item, 'name'));
      if (name !== undefined) {
        map[name] = item;
      }
    }
    return map;
  }
  return isRecord(properties) ? properties : {};
}

/** The property bag of an object (handles object-map or array forms). */
export function propMap(obj: RawObject): Record<string, unknown> {
  return toPropMap(obj.properties);
}

/** A scalar `IntProperty`/`FloatProperty` value by property name. */
export function numberField(bag: Record<string, unknown>, name: string): number | undefined {
  return asNumber(dig(bag[name], 'value'));
}

/** A `BoolProperty` value by property name. */
export function boolField(bag: Record<string, unknown>, name: string): boolean | undefined {
  return asBoolean(dig(bag[name], 'value'));
}

/** The inner property bag of a `StructProperty` by name (e.g. `mPlayerRules`). */
export function structField(bag: Record<string, unknown>, name: string): Record<string, unknown> {
  return toPropMap(dig(bag[name], 'value', 'properties'));
}

/** An `ObjectProperty` reference's `pathName` by property name. */
export function refField(bag: Record<string, unknown>, name: string): string | undefined {
  return asString(dig(bag[name], 'value', 'pathName'));
}

/** An `ArrayProperty`'s entries by property name. */
export function arrayField(bag: Record<string, unknown>, name: string): unknown[] {
  return asArray(dig(bag[name], 'values'));
}

/**
 * An `EnumProperty`/`ByteProperty` literal by property name, with any `Enum::`
 * namespace stripped — `mNodeRandomization` → `NRM_Strict`, `mPurityOverride` →
 * `RP_Pure`. Both store the literal as `value.value`; returns undefined if absent.
 */
export function enumField(bag: Record<string, unknown>, name: string): string | undefined {
  const literal = asString(dig(bag[name], 'value', 'value'));
  if (literal === undefined) {
    return undefined;
  }
  return literal.includes('::') ? literal.slice(literal.lastIndexOf('::') + 2) : literal;
}

/** The inner property bag of a struct array entry (e.g. an InventoryStack). */
export function entryProps(entry: unknown): Record<string, unknown> {
  return toPropMap(dig(entry, 'properties'));
}

/** A validated world position from an actor's transform, if present and finite. */
export function translation(obj: RawObject): Vec3 | undefined {
  return toVec3(obj.transform?.translation);
}

function toVec3(raw: RawVector | undefined): Vec3 | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const x = asNumber(raw.x);
  const y = asNumber(raw.y);
  const z = asNumber(raw.z);
  if (x === undefined || y === undefined || z === undefined) {
    return undefined;
  }
  return { x, y, z };
}

/**
 * Converts the header's save time (unix milliseconds as a string, as the parser library gives it)
 * to ISO 8601 UTC. "0" means no time was recorded and yields undefined silently; anything else
 * unusable yields undefined plus a warning.
 */
export function saveDateTimeToIso(raw: string | undefined, warnings: Warnings): string | undefined {
  if (raw === undefined || raw === '0') {
    return undefined;
  }
  const milliseconds = Number(raw);
  const date = new Date(milliseconds);
  if (!/^\d+$/.test(raw) || Number.isNaN(date.getTime())) {
    warnings.add(`Unreadable save timestamp '${raw}'; save time unknown.`);
    return undefined;
  }
  return date.toISOString();
}
