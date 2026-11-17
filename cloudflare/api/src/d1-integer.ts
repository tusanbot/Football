const SQLITE_INT64_MIN = -(1n << 63n);
const SQLITE_INT64_MAX = (1n << 63n) - 1n;

/**
 * D1's binding API does not accept JavaScript bigint. Bind decimal strings:
 * SQLite INTEGER affinity stores them as signed 64-bit integers when in range.
 */
export function toD1Integer(value: bigint | string | number): string {
  let integer: bigint;
  try {
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) {
        throw new TypeError("Unsafe JavaScript number cannot represent an exact database integer");
      }
      integer = BigInt(value);
    } else {
      integer = BigInt(value);
    }
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Database integer must be a valid decimal integer");
  }

  if (integer < SQLITE_INT64_MIN || integer > SQLITE_INT64_MAX) {
    throw new RangeError("Database integer is outside SQLite signed 64-bit range");
  }
  return integer.toString();
}

/**
 * Select D1 INTEGER columns as CAST(column AS TEXT) before calling this helper.
 * Reject unsafe Number values because precision may already have been lost.
 */
export function fromD1Integer(value: string | number | null): bigint | null {
  if (value === null) return null;
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new TypeError("D1 returned an unsafe Number; select the column using CAST(... AS TEXT)");
  }
  try {
    const integer = BigInt(value);
    if (integer < SQLITE_INT64_MIN || integer > SQLITE_INT64_MAX) {
      throw new RangeError("Database integer is outside SQLite signed 64-bit range");
    }
    return integer;
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) throw error;
    throw new TypeError("D1 integer result must be a decimal integer");
  }
}
