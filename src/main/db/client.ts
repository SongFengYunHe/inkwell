import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { migrations } from './migrations'

export type InkwellDatabase = BetterSQLite3Database<typeof schema>

let sqlite: Database.Database | null = null
let db: InkwellDatabase | null = null
let databasePath = ''

/** 打开（或创建）数据库，执行 PRAGMA 与迁移。可重复调用，幂等。 */
export function initDatabase(filePath: string): InkwellDatabase {
  if (db) return db

  const connection = new Database(filePath)
  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')
  connection.pragma('synchronous = NORMAL')

  runMigrations(connection)

  sqlite = connection
  db = drizzle(connection, { schema })
  databasePath = filePath
  return db
}

/** 获取已初始化的数据库实例 */
export function getDb(): InkwellDatabase {
  if (!db) throw new Error('数据库尚未初始化，请先调用 initDatabase()')
  return db
}

/** 数据库文件绝对路径 */
export function getDatabasePath(): string {
  return databasePath
}

/** 关闭数据库连接（退出前调用，确保 WAL 落盘） */
export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close()
    sqlite = null
    db = null
  }
}

/** 由 schema_version 驱动的迁移执行器 */
function runMigrations(connection: Database.Database): void {
  connection.exec(
    `CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`
  )

  const appliedRows = connection
    .prepare('SELECT version FROM schema_version')
    .all() as Array<{ version: number }>
  const applied = new Set(appliedRows.map((row) => row.version))

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue

    const apply = connection.transaction(() => {
      for (const statement of migration.statements) {
        connection.exec(statement)
      }
      connection
        .prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
        .run(migration.version, Date.now())
    })

    apply()
  }
}