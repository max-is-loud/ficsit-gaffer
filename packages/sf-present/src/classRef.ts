// Display-name fallback for a class that has no authored game-data name: strips Unreal prefixes and
// suffixes and spaces out camel case.

/**
 * Best-effort human-readable name for a class, used as a display-name fallback
 * when a class is referenced but has no authored game-data name. Strips the common
 * Unreal prefixes/suffixes (including save-instance forms — `_UAID_…`, `_C_<n>`,
 * and `Schematic`/`GP`/`Char`/`Research`/`Alternate` prefixes) and spaces out the
 * remaining camel case. Returns the original class name if nothing readable
 * remains. e.g. `Desc_IronPlate_C` → "Iron Plate", `Recipe_Alternate_Wire_1_C` →
 * "Wire 1", `Research_Caterium_C` → "Caterium".
 *
 * This is presentation, not identity (cf. `classNameFromPath`/`extractClassNames`
 * in `@foreman/sf-core`): the neutral data libraries emit raw class names and the
 * edge humanises here. See `docs/component-architecture.md` → Presentation boundary.
 */
export function humaniseClassName(className: string): string {
  let s = className;
  // Drop any `_UAID_…` instance suffix. Done with indexOf+slice rather than a
  // `/_UAID_.*$/` regex to keep it strictly linear on untrusted save input.
  const uaid = s.toUpperCase().indexOf('_UAID_');
  if (uaid !== -1) {
    s = s.slice(0, uaid);
  }
  s = s.replace(/_C(_\d+)?$/, '');
  s = s.replace(/^(Desc|Recipe|Build|BP|Schematic|GP|Char|Research)_/, '');
  s = s.replace(/^Alternate_/, '');
  s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  s = s.replace(/_/g, ' ').trim();
  return s.length > 0 ? s : className;
}
