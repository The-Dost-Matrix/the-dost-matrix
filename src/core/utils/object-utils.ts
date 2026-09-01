/**
 * Type guard that checks whether a given value is a plain, non-empty object.
 *
 * "Non-empty" means the object has at least one own enumerable property.
 * This is useful for validation logic across the core layer, e.g. to guard
 * against empty payloads, malformed contracts, or incomplete data before
 * further processing (repositories, mission-engine, contracts, etc.).
 *
 * @param value - The value to check.
 * @returns `true` if `value` is a plain object with at least one own
 *          enumerable property, `false` otherwise.
 *
 * @example
 * isNonEmptyObject({ foo: 'bar' }); // true
 * isNonEmptyObject({});             // false
 * isNonEmptyObject(null);           // false
 * isNonEmptyObject([1, 2, 3]);      // false
 */
export function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  return Object.keys(value as Record<string, unknown>).length > 0;
}