import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCHEMA_PATH = resolve(ROOT, "apps/api/prisma/schema.prisma");
const OUTPUT_DIR = resolve(ROOT, "cloudflare/api/schema");
const MIGRATION_PATH = resolve(ROOT, "cloudflare/api/migrations/0002_game_schema.sql");
const SCALAR_TYPES = new Set(["String", "Int", "BigInt", "Float", "Boolean", "DateTime", "Json"]);

function readBalancedArgument(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const open = start + marker.length - 1;
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error("Unclosed Prisma attribute: " + marker);
}

function splitList(value) {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function parseField(line, modelNames, enumNames) {
  const match = line.match(/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*(?:\[\]|\?)?)(.*)$/);
  if (!match) return null;
  const [, name, rawType, tail] = match;
  const isList = rawType.endsWith("[]");
  const isOptional = rawType.endsWith("?");
  const type = rawType.replace(/\[\]|\?/g, "");
  const relationArgs = readBalancedArgument(tail, "@relation(");
  const relation = relationArgs ? {
    fields: (relationArgs.match(/\bfields\s*:\s*\[([^\]]*)\]/) || [])[1]
      ? splitList(relationArgs.match(/\bfields\s*:\s*\[([^\]]*)\]/)[1]) : [],
    references: (relationArgs.match(/\breferences\s*:\s*\[([^\]]*)\]/) || [])[1]
      ? splitList(relationArgs.match(/\breferences\s*:\s*\[([^\]]*)\]/)[1]) : [],
    onDelete: (relationArgs.match(/\bonDelete\s*:\s*(\w+)/) || [])[1] || (isOptional ? "SetNull" : "Restrict"),
    onUpdate: (relationArgs.match(/\bonUpdate\s*:\s*(\w+)/) || [])[1] || "Cascade"
  } : null;
  const defaultArgs = readBalancedArgument(tail, "@default(");
  const dbType = (tail.match(/@db\.([A-Za-z_]\w*)(?:\((\d+)\))?/) || []);
  return {
    name, type, rawType, isList, isOptional,
    isRelation: modelNames.has(type),
    isEnum: enumNames.has(type),
    isScalar: SCALAR_TYPES.has(type) || enumNames.has(type),
    isId: /@id\b/.test(tail),
    isUnique: /@unique\b/.test(tail),
    isUpdatedAt: /@updatedAt\b/.test(tail),
    default: defaultArgs,
    dbAnnotation: dbType[1] ? { name: dbType[1], argument: dbType[2] || null } : null,
    relation
  };
}

function parseBlockDefinitions(source, kind) {
  const expression = new RegExp("(^|\\n)\\s*" + kind + "\\s+([A-Za-z_]\\w*)\\s*\\{([\\s\\S]*?)\\n\\}", "g");
  const results = [];
  for (const match of source.matchAll(expression)) {
    results.push({ name: match[2], body: match[3] });
  }
  return results;
}

function parseModelAttributes(body) {
  const indexes = [];
  const uniques = [];
  const ids = [];
  for (const line of body.split(/\r?\n/)) {
    const match = line.trim().match(/^@@(index|unique|id)\s*\(\s*\[([^\]]+)\]/);
    if (!match) continue;
    const item = { fields: splitList(match[2]).map((field) => field.replace(/\s*\(.*/, "").trim()) };
    if (match[1] === "index") indexes.push(item);
    else if (match[1] === "unique") uniques.push(item);
    else ids.push(item);
  }
  return { indexes, uniques, ids };
}

export function parsePrismaSchema(source) {
  const normalized = source.replace(/\/\/.*$/gm, "");
  const enumBlocks = parseBlockDefinitions(normalized, "enum");
  const enums = new Map();
  for (const block of enumBlocks) {
    enums.set(block.name, block.body.split(/\r?\n/).map((line) => line.trim())
      .filter((line) => /^[A-Za-z_]\w*$/.test(line)));
  }
  const modelBlocks = parseBlockDefinitions(normalized, "model");
  const modelNames = new Set(modelBlocks.map((model) => model.name));
  const enumNames = new Set(enums.keys());
  const models = modelBlocks.map((block) => {
    const fields = [];
    for (const line of block.body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("@@")) continue;
      const field = parseField(trimmed, modelNames, enumNames);
      if (field) fields.push(field);
    }
    const attrs = parseModelAttributes(block.body);
    const map = block.body.match(/@@map\("([^"]+)"\)/);
    return {
      name: block.name,
      tableName: map ? map[1] : block.name,
      fields,
      relations: fields.filter((field) => field.isRelation),
      columns: fields.filter((field) => field.isScalar),
      ...attrs
    };
  });
  return { enums: Object.fromEntries(enums), models };
}

function sqlString(value) {
  return "'" + value.replace(/'/g, "''") + "'";
}

function fieldMap(model, fieldName) {
  return model.fields.find((field) => field.name === fieldName)?.name || fieldName;
}

function columnType(field, enums) {
  if (field.isEnum) return "TEXT";
  if (field.isList) return "TEXT";
  switch (field.type) {
    case "String": return "TEXT";
    case "Int": return "INTEGER";
    case "BigInt": return "INTEGER";
    case "Float": return "REAL";
    case "Boolean": return "INTEGER";
    case "DateTime": return "TEXT";
    case "Json": return "TEXT";
    default:
      if (enums[field.type]) return "TEXT";
      return "TEXT";
  }
}

function sqlDefault(field) {
  if (!field.default) return null;
  const value = field.default.trim();
  if (value === "now()") return "CURRENT_TIMESTAMP";
  if (value === "true") return "1";
  if (value === "false") return "0";
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  if (value === "[]") return "'[]'";
  if (value === "{}") return "'{}'";
  if (/^".*"$/.test(value)) return sqlString(value.slice(1, -1));
  if (/^[A-Za-z_]\w*$/.test(value)) return sqlString(value);
  // cuid(), uuid(), autoincrement() and dbgenerated() remain application-managed.
  return null;
}

function fieldChecks(field, enums) {
  const checks = [];
  if (field.type === "Boolean") checks.push("CHECK (" + field.name + " IN (0, 1))");
  if (field.isEnum && enums[field.type]) {
    checks.push("CHECK (" + field.name + " IN (" + enums[field.type].map(sqlString).join(", ") + "))");
  }
  if (field.type === "Json" || field.isList) checks.push("CHECK (" + field.name + " IS NULL OR json_valid(" + field.name + "))");
  if (field.dbAnnotation?.name === "VarChar" && field.dbAnnotation.argument) {
    checks.push("CHECK (" + field.name + " IS NULL OR length(" + field.name + ") <= " + field.dbAnnotation.argument + ")");
  }
  return checks;
}

function safeName(value) {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

export function generateD1Schema(parsed, sourceHash) {
  const unsupported = parsed.models.flatMap((model) => model.fields.filter((field) => !field.isScalar && !field.isRelation).map((field) => model.name + "." + field.name + ":" + field.rawType));
  if (unsupported.length) throw new Error("Unsupported Prisma field types: " + unsupported.join(", "));
  const enums = parsed.enums;
  const modelByName = new Map(parsed.models.map((model) => [model.name, model]));
  const statements = [
    "-- Generated from apps/api/prisma/schema.prisma. Do not edit by hand.",
    "-- BigInt uses signed 64-bit SQLite INTEGER; D1 code MUST bind decimal strings and read CAST(column AS TEXT).",
    "-- cuid()/uuid() and @updatedAt remain application-managed.",
    "-- Review this migration against the PostgreSQL migration history before applying.",
    ""
  ];
  const allIndexes = [];
  for (const model of parsed.models) {
    const columns = [];
    const compositeIdFields = new Set(model.ids.flatMap((item) => item.fields));
    for (const field of model.columns) {
      const parts = ['"' + field.name + '"', columnType(field, enums)];
      if (field.isId) parts.push("PRIMARY KEY");
      if (!field.isOptional || field.isId || compositeIdFields.has(field.name)) parts.push("NOT NULL");
      if (field.isUnique && !field.isId) parts.push("UNIQUE");
      const defaultValue = sqlDefault(field);
      if (defaultValue !== null && !field.isId) parts.push("DEFAULT " + defaultValue);
      parts.push(...fieldChecks(field, enums));
      columns.push("  " + parts.join(" "));
    }
    for (const relationField of model.relations) {
      const relation = relationField.relation;
      const target = modelByName.get(relationField.type);
      if (!target || !relation || !relation.fields.length || relation.fields.length !== relation.references.length) continue;
      const onDelete = ["Cascade", "Restrict", "SetNull", "SetDefault", "NoAction"].includes(relation.onDelete)
        ? relation.onDelete.replace(/[A-Z]/g, (letter) => " " + letter.toUpperCase()).trim().toUpperCase() : "NO ACTION";
      const onUpdate = ["Cascade", "Restrict", "SetNull", "SetDefault", "NoAction"].includes(relation.onUpdate)
        ? relation.onUpdate.replace(/[A-Z]/g, (letter) => " " + letter.toUpperCase()).trim().toUpperCase() : "NO ACTION";
      const local = relation.fields.map((name) => '"' + fieldMap(model, name) + '"').join(", ");
      const remote = relation.references.map((name) => '"' + fieldMap(target, name) + '"').join(", ");
      columns.push("  FOREIGN KEY (" + local + ') REFERENCES "' + target.tableName + '" (' + remote + ") ON DELETE " + onDelete + " ON UPDATE " + onUpdate);
    }
    if (model.ids.length) {
      columns.push("  PRIMARY KEY (" + model.ids[0].fields.map((name) => '"' + name + '"').join(", ") + ")");
    }
    statements.push('CREATE TABLE IF NOT EXISTS "' + model.tableName + '" (');
    statements.push(columns.join(",\n"));
    statements.push(");");
    for (const unique of model.uniques) {
      const name = safeName("uq_" + model.tableName + "_" + unique.fields.join("_"));
      allIndexes.push("CREATE UNIQUE INDEX IF NOT EXISTS " + name + ' ON "' + model.tableName + '" (' + unique.fields.map((name) => '"' + name + '"').join(", ") + ");");
    }
    for (const index of model.indexes) {
      const name = safeName("ix_" + model.tableName + "_" + index.fields.join("_"));
      allIndexes.push("CREATE INDEX IF NOT EXISTS " + name + ' ON "' + model.tableName + '" (' + index.fields.map((name) => '"' + name + '"').join(", ") + ");");
    }
  }
  statements.push("", "-- Secondary indexes");
  statements.push(...allIndexes);
  statements.push("", "CREATE TABLE IF NOT EXISTS fe_write_guard (assertion INTEGER NOT NULL CHECK (assertion = 1));");
  statements.push("INSERT OR IGNORE INTO fe_schema_migrations (version) VALUES ('0002_game_schema');");
  statements.push("", "-- Source schema SHA-256: " + sourceHash);
  return statements.join("\n") + "\n";
}

export function buildInventory(parsed, sourceHash) {
  const models = parsed.models.map((model) => ({
    name: model.name,
    tableName: model.tableName,
    scalarColumns: model.columns.length,
    relationFields: model.relations.length,
    indexes: model.indexes,
    uniqueConstraints: [
      ...model.uniques,
      ...model.columns.filter((field) => field.isUnique).map((field) => ({ fields: [field.name], fieldLevel: true }))
    ],
    fields: model.columns.map((field) => ({
      name: field.name,
      prismaType: field.rawType,
      nullable: field.isOptional,
      d1Type: columnType(field, parsed.enums),
      enum: field.isEnum ? field.type : null,
      default: field.default,
      updatedAt: field.isUpdatedAt,
      dbAnnotation: field.dbAnnotation
    })),
    foreignKeys: model.relations.filter((field) => field.relation).map((field) => ({
      field: field.name,
      target: field.type,
      columns: field.relation.fields,
      references: field.relation.references,
      onDelete: field.relation.onDelete,
      onUpdate: field.relation.onUpdate
    }))
  }));
  const allFields = models.flatMap((model) => model.fields);
  return {
    source: "apps/api/prisma/schema.prisma",
    sourceSha256: sourceHash,
    target: "Cloudflare D1 / SQLite",
    mappingPolicy: {
      String: "TEXT",
      Int: "INTEGER",
      BigInt: "INTEGER (signed 64-bit; decimal-string bind and CAST-to-TEXT reads required)",
      Float: "REAL",
      Boolean: "INTEGER with CHECK 0/1",
      DateTime: "TEXT (ISO-8601; @db.Date remains YYYY-MM-DD)",
      Json: "TEXT with json_valid CHECK",
      enum: "TEXT with CHECK against declared enum values",
      scalarArray: "TEXT JSON array with json_valid CHECK"
    },
    totals: {
      models: models.length,
      enums: Object.keys(parsed.enums).length,
      scalarColumns: allFields.length,
      relations: models.reduce((sum, model) => sum + model.relationFields, 0),
      unsupportedFields: parsed.models.flatMap((model) => model.fields.filter((field) => !field.isScalar && !field.isRelation)).length,
      indexes: models.reduce((sum, model) => sum + model.indexes.length, 0),
      compoundUniqueConstraints: models.reduce((sum, model) => sum + model.uniqueConstraints.filter((item) => item.fields.length > 1).length, 0),
      bigIntColumns: allFields.filter((field) => field.prismaType.replace(/[?\[\]]/g, "") === "BigInt").length,
      jsonColumns: allFields.filter((field) => field.prismaType.replace(/[?\[\]]/g, "") === "Json").length,
      arrayColumns: allFields.filter((field) => field.prismaType.endsWith("[]")).length,
      updatedAtColumns: allFields.filter((field) => field.updatedAt).length
    },
    enums: parsed.enums,
    models
  };
}

export function convertPrismaSchema(source) {
  const parsed = parsePrismaSchema(source);
  const sourceHash = createHash("sha256").update(source).digest("hex");
  return {
    inventory: buildInventory(parsed, sourceHash),
    sql: generateD1Schema(parsed, sourceHash)
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = readFileSync(SCHEMA_PATH, "utf8");
  const converted = convertPrismaSchema(source);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(resolve(OUTPUT_DIR, "prisma-d1-inventory.json"), JSON.stringify(converted.inventory, null, 2) + "\n");
  writeFileSync(MIGRATION_PATH, converted.sql);
  console.log(JSON.stringify(converted.inventory.totals, null, 2));
  console.log("Wrote cloudflare/api/schema/prisma-d1-inventory.json");
  console.log("Wrote cloudflare/api/migrations/0002_game_schema.sql");
}
