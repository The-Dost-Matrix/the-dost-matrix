export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type EntityId = string;
export type IsoDateTime = string;
export type SchemaVersion = `${number}.${number}`;

export interface ActorRef {
  type: "owner" | "director" | "role" | "system";
  id: EntityId;
}

export interface CommonMetadata {
  id: EntityId;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  createdBy: ActorRef;
  correlationId: EntityId;
  causationId?: EntityId;
}

export function assertNonEmptyString(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} mag niet leeg zijn.`);
  }
}

export function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} moet een positief geheel getal zijn.`);
  }
}

export function assertNonNegativeNumber(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} moet een eindig, niet-negatief getal zijn.`);
  }
}

export function assertIsoDateTime(value: string, fieldName: string): void {
  assertNonEmptyString(value, fieldName);

  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${fieldName} moet een geldige ISO-datum zijn.`);
  }
}

export function isOneOf<const T extends readonly string[]>(
  value: string,
  allowedValues: T,
): value is T[number] {
  return allowedValues.includes(value);
}
