import { TypeID, typeid } from "typeid-js";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

/**
 * TypeID registry for OpenWork desktop-local state (SQLite DB on the user's machine).
 *
 * This is intentionally SEPARATE from the cloud registry in
 * `ee/packages/utils/src/typeid.ts`. That one is for cloud/Den resources; this one is
 * for desktop-app state (workspaces, tokens, env vars, sessions, audit, etc.) and is
 * shared across the server, electron, and frontend.
 *
 * TypeID prefixes are persisted in DB rows: APPEND new entries, never change existing
 * values.
 */

export const TYPE_ID_SUFFIX_LENGTH = 26;

const BASE32_REGEX = /^[0-9a-hjkmnp-tv-z]+$/;

export const idTypesMapNameToPrefix = {
  // Workspaces & per-workspace metadata
  workspace: "ws",
  authorizedRoot: "aroot",
  workspaceMeta: "wsmeta",
  blueprintSession: "bps",
  desktopCloudSync: "dcs",
  cloudImport: "cimp",

  // Tokens & server identity
  token: "owt",
  workspaceServerToken: "wst",
  workspacePort: "wport",

  // Environment variables
  envVar: "env",

  // Audit
  audit: "aud",

  // File sessions (file-sync API)
  fileSession: "fses",
  fileSessionEvent: "fsev",

  // Per-session preferences (greenfield)
  sessionPref: "spref",

  // OpenCode config projection (replaces opencode.json keys)
  opencodeConfig: "occ",
  mcpServer: "mcp",
  pluginEntry: "plg",

  // Extensions
  googleWorkspaceVault: "gwv",
  extensionState: "ext",

  // Generic preferences (renderer localStorage migration)
  preference: "pref",
} as const;

type IdTypesMapNameToPrefix = typeof idTypesMapNameToPrefix;
type IdTypesMapPrefixToName = {
  [K in keyof IdTypesMapNameToPrefix as IdTypesMapNameToPrefix[K]]: K;
};

const idTypesMapPrefixToName = Object.fromEntries(
  Object.entries(idTypesMapNameToPrefix).map(([name, prefix]) => [prefix, name]),
) as IdTypesMapPrefixToName;

export type IdTypePrefixNames = keyof typeof idTypesMapNameToPrefix;
export type TypeId<T extends IdTypePrefixNames> = `${IdTypesMapNameToPrefix[T]}_${string}`;

type TypeIdSchema<T extends IdTypePrefixNames> = z.ZodType<TypeId<T>, string>;

const schemaCache = new Map<IdTypePrefixNames, z.ZodType<string, string>>();

const buildTypeIdSchema = <const T extends IdTypePrefixNames>(prefix: T): TypeIdSchema<T> => {
  const expectedPrefix = idTypesMapNameToPrefix[prefix];
  const expectedLength = TYPE_ID_SUFFIX_LENGTH + expectedPrefix.length + 1;

  return z
    .string()
    .length(expectedLength, {
      message: `TypeID must be ${expectedLength} characters (${expectedPrefix}_<26 char suffix>)`,
    })
    .startsWith(`${expectedPrefix}_`, {
      message: `TypeID must start with '${expectedPrefix}_'`,
    })
    .refine(
      (input) => {
        const suffix = input.slice(expectedPrefix.length + 1);
        return BASE32_REGEX.test(suffix);
      },
      { message: "TypeID suffix contains invalid base32 characters" },
    )
    .refine(
      (input) => {
        try {
          TypeID.fromString(input);
          return true;
        } catch {
          return false;
        }
      },
      { message: "TypeID is structurally invalid" },
    )
    .transform((input) => TypeID.fromString(input).toString() as TypeId<T>);
};

const typeIdZodSchema = <const T extends IdTypePrefixNames>(prefix: T): TypeIdSchema<T> => {
  let schema = schemaCache.get(prefix);
  if (!schema) {
    schema = buildTypeIdSchema(prefix);
    schemaCache.set(prefix, schema);
  }
  return schema as TypeIdSchema<T>;
};

const typeIdGenerator = <const T extends IdTypePrefixNames>(prefix: T) =>
  typeid(idTypesMapNameToPrefix[prefix]).toString() as TypeId<T>;

const validateTypeId = <const T extends IdTypePrefixNames>(
  prefix: T,
  data: unknown,
): data is TypeId<T> => typeIdZodSchema(prefix).safeParse(data).success;

const inferTypeId = <T extends keyof IdTypesMapPrefixToName>(
  input: `${T}_${string}`,
): IdTypesMapPrefixToName[T] => {
  const parsed = TypeID.fromString(input);
  const prefix = parsed.getType() as T;
  const typeName = idTypesMapPrefixToName[prefix];

  if (typeName === undefined) {
    throw new Error(
      `Unknown TypeID prefix '${prefix}'. Registered prefixes: ${Object.keys(idTypesMapPrefixToName).join(", ")}`,
    );
  }

  return typeName;
};

const typeIdFromString = <const T extends IdTypePrefixNames>(
  typeName: T,
  input: string,
): TypeId<T> => {
  const parsed = TypeID.fromString(input);
  const expectedPrefix = idTypesMapNameToPrefix[typeName];
  const actualPrefix = parsed.getType();

  if (actualPrefix !== expectedPrefix) {
    throw new Error(
      `TypeID prefix mismatch: expected '${expectedPrefix}' but got '${actualPrefix}'`,
    );
  }

  return parsed.toString() as TypeId<T>;
};

const typeIdWithTimestamp = <const T extends IdTypePrefixNames>(
  typeName: T,
  timestamp?: Date | number,
): TypeId<T> => {
  let msecs: number;

  if (timestamp === undefined) {
    msecs = Date.now();
  } else if (timestamp instanceof Date) {
    msecs = timestamp.getTime();
  } else {
    msecs = timestamp;
  }

  if (!Number.isFinite(msecs)) {
    throw new Error(`Invalid timestamp: expected finite number, got ${msecs}`);
  }
  if (msecs < 0) {
    throw new Error(`Invalid timestamp: expected non-negative number, got ${msecs}`);
  }

  const uuid = uuidv7({ msecs });
  const prefix = idTypesMapNameToPrefix[typeName];
  return TypeID.fromUUID(prefix, uuid).toString() as TypeId<T>;
};

const getColumnLength = <const T extends IdTypePrefixNames>(typeName: T) =>
  idTypesMapNameToPrefix[typeName].length + 1 + TYPE_ID_SUFFIX_LENGTH;

export const typeId = {
  schema: typeIdZodSchema,
  generator: typeIdGenerator,
  generatorWithTimestamp: typeIdWithTimestamp,
  validator: validateTypeId,
  infer: inferTypeId,
  fromString: typeIdFromString,
  suffixLength: TYPE_ID_SUFFIX_LENGTH,
  prefix: idTypesMapNameToPrefix,
  columnLength: getColumnLength,
};

export type DesktopTypeIdName = IdTypePrefixNames;
export type DesktopTypeId<TName extends DesktopTypeIdName> = TypeId<TName>;

export function createDesktopTypeId<TName extends DesktopTypeIdName>(
  name: TName,
): DesktopTypeId<TName> {
  return typeId.generator(name);
}

export function normalizeDesktopTypeId<TName extends DesktopTypeIdName>(
  name: TName,
  value: string,
): DesktopTypeId<TName> {
  return typeId.fromString(name, value);
}

export function isDesktopTypeId<TName extends DesktopTypeIdName>(
  name: TName,
  value: unknown,
): value is DesktopTypeId<TName> {
  return typeId.validator(name, value);
}
