import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as schema from './schema'
import { migrations } from './migrations'

export type InkwellDatabase = BetterSQLite3Database<typeof schema>

export type JournalMode = 'WAL' | 'DELETE'

export interface InitDatabaseOptions {
  /**
   * WAL 在网络盘 / 同步盘（OneDrive 等）上极易损坏；
   * 预检命中时降级为 DELETE，牺牲并发换取安全。
   */
  journalMode?: JournalMode
}

let sqlite: Database.Database | null = null
let db: InkwellDatabase | null = null
let databasePath = ''
let journalMode: JournalMode = 'WAL'

/** 打开（或创建）数据库，执行 PRAGMA 与迁移。可重复调用，幂等。 */
export function initDatabase(filePath: string, options: InitDatabaseOptions = {}): InkwellDatabase {
  if (db) return db

  const mode: JournalMode = options.journalMode ?? 'WAL'
  const connection = new Database(filePath)
  connection.pragma(`journal_mode = ${mode}`)
  connection.pragma('foreign_keys = ON')
  connection.pragma('synchronous = NORMAL')
  // 桌面应用与 MCP Server 可能同时打开同一个库，给写入留出重试时间
  connection.pragma('busy_timeout = 5000')

  runMigrations(connection, filePath)

  sqlite = connection
  db = drizzle(connection, { schema })
  databasePath = filePath
  journalMode = mode
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

/** 当前数据库是否已打开 */
export function isDatabaseOpen(): boolean {
  return db !== null
}

/** 当前生效的 journal 模式（WAL / DELETE），供 UI 展示降级说明 */
export function getJournalMode(): JournalMode {
  return journalMode
}

/**
 * 关闭数据库连接（退出前 / 切换书库前调用，确保 WAL 落盘）。
 * 关闭前先 checkpoint，避免留下体积巨大的 -wal 残留。
 */
export function closeDatabase(): void {
  if (!sqlite) return
  try {
    if (journalMode === 'WAL') sqlite.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // checkpoint 失败不阻塞关闭
  }
  sqlite.close()
  sqlite = null
  db = null
  databasePath = ''
}

/** 备份文件时间戳：YYYYMMDD-HHMMSS */
function backupStamp(now = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/**
 * 迁移前强制自动备份（迁移铁律，计划书 §6）：
 *   - 仅在「存在待执行迁移且数据库非空（已应用迁移数 > 0）」时执行；
 *   - 全新空库不备份；
 *   - 备份失败不静默跳过：打印 console.error 后继续（迁移本身在事务中，失败会整体回滚）。
 */
function backupBeforeMigrate(
  connection: Database.Database,
  filePath: string,
  appliedCount: number,
  targetVersion: number
): void {
  if (appliedCount <= 0) return
  const dir = join(dirname(filePath), 'backups')
  const target = join(dir, `inkwell-${backupStamp()}-pre-migrate-v${targetVersion}.db`)
  try {
    mkdirSync(dir, { recursive: true })
    connection.pragma('wal_checkpoint(TRUNCATE)')
    connection.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    console.log(`[inkwell] pre-migration backup created: ${target}`)
  } catch (error) {
    // 备份失败不阻断迁移：至少留下可排查的日志，事务仍保证迁移原子性
    console.error('[inkwell] pre-migration backup failed:', error)
  }
}

/** 由 schema_version 驱动的迁移执行器 */
function runMigrations(connection: Database.Database, filePath: string): void {
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

  const pending = migrations.filter((migration) => !applied.has(migration.version))
  if (pending.length > 0) {
    const targetVersion = pending.reduce((max, item) => Math.max(max, item.version), 0)
    backupBeforeMigrate(connection, filePath, applied.size, targetVersion)
  }

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

/** 读取某个库文件的 schema_version（不触发迁移，用于校验 / 展示） */
export function readSchemaVersion(filePath: string): number | null {
  let probe: Database.Database | null = null
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true })
    const row = probe
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`)
      .get() as { name: string } | undefined
    if (!row) return null
    const version = probe.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
    return version.v ?? 0
  } catch {
    return null
  } finally {
    probe?.close()
  }
}

/** 目标 schema 版本（迁移列表中的最大值） */
export function latestSchemaVersion(): number {
  return migrations.reduce((max, item) => Math.max(max, item.version), 0)
}

/**
 * 用当前连接生成一份一致快照（SQLite 官方在线备份）。
 * WAL 会被合并进目标文件，因此可作为干净的备份 / 迁移载体。
 */
export function vacuumInto(targetPath: string): void {
  if (!sqlite) throw new Error('数据库尚未初始化')
  sqlite.pragma('wal_checkpoint(TRUNCATE)')
  sqlite.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`)
}