import { customType, integer, text } from "drizzle-orm/sqlite-core";
import {
  type DesktopTypeId,
  type DesktopTypeIdName,
  normalizeDesktopTypeId,
} from "./typeid";

/**
 * SQLite column helpers for the desktop DB.
 *
 * Mirrors the conventions in `ee/packages/den-db/src/columns.ts` but targets SQLite
 * (better-sqlite3) instead of MySQL/PlanetScale.
 */

/**
 * A TypeID-backed text primary/foreign key column. Values are normalized (validated)
 * on the way in and out, so the column always stores a canonical `<prefix>_<suffix>`.
 */
export const typeIdColumn = <TName extends DesktopTypeIdName>(name: TName, columnName: string) =>
  customType<{ data: DesktopTypeId<TName>; driverData: string }>({
    dataType() {
      return "text";
    },
    toDriver(value) {
      return normalizeDesktopTypeId(name, value);
    },
    fromDriver(value) {
      return normalizeDesktopTypeId(name, value);
    },
  })(columnName);

/**
 * A JSON column stored as TEXT, transparently (de)serialized.
 */
export const jsonColumn = <TData>(columnName: string) =>
  customType<{ data: TData; driverData: string }>({
    dataType() {
      return "text";
    },
    toDriver(value) {
      return JSON.stringify(value);
    },
    fromDriver(value) {
      return JSON.parse(value) as TData;
    },
  })(columnName);

/**
 * Epoch-milliseconds timestamp helper.
 */
export const epochMs = (columnName: string) => integer(columnName, { mode: "number" });

/**
 * Standard created_at / updated_at columns (epoch ms). Defaults are applied in code
 * (better-sqlite3 has no `ON UPDATE`), see `withTimestamps` in the DAL.
 */
export const timestamps = {
  createdAt: epochMs("created_at").notNull(),
  updatedAt: epochMs("updated_at").notNull(),
};

/**
 * A nullable secret text column. SQLite stores it as plaintext TEXT; encryption is a
 * separate concern (see plan.md open question on at-rest encryption). This wrapper
 * exists so secret-bearing columns are easy to grep and to later swap for an encrypted
 * customType without touching the schema.
 */
export const secretText = (columnName: string) => text(columnName);
