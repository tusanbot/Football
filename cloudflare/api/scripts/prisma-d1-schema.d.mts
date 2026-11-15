export interface D1SchemaTotals {
  models: number; enums: number; scalarColumns: number; relations: number;
  indexes: number; compoundUniqueConstraints: number; bigIntColumns: number;
  jsonColumns: number; arrayColumns: number; updatedAtColumns: number; unsupportedFields: number;
}
export interface D1SchemaInventory {
  source: string; sourceSha256: string; target: string; totals: D1SchemaTotals;
  enums: Record<string, string[]>; models: Array<Record<string, unknown>>;
}
export function convertPrismaSchema(source: string): { inventory: D1SchemaInventory; sql: string };
