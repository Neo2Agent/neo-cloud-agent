import { connectMysql, type MysqlMetadataStore } from "./mysql.js";
import { connectPostgres, type PostgresMetadataStore } from "./postgres.js";

export type MetadataStore = PostgresMetadataStore | MysqlMetadataStore;
export type DatabaseKind = "mysql" | "postgres";

export function databaseKindFromUrl(url: string): DatabaseKind {
  const scheme = url.split(":")[0]?.toLowerCase() ?? "";
  if (scheme === "mysql" || scheme === "mariadb") {
    return "mysql";
  }
  if (scheme === "postgres" || scheme === "postgresql") {
    return "postgres";
  }
  throw new Error(`unsupported DATABASE_URL scheme: ${scheme || "missing"}`);
}

export async function connectDatabase(url: string): Promise<{ kind: DatabaseKind; store: MetadataStore }> {
  const kind = databaseKindFromUrl(url);
  if (kind === "mysql") {
    return { kind, store: await connectMysql(url) };
  }
  return { kind, store: await connectPostgres(url) };
}
