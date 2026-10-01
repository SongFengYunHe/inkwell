import Database from 'better-sqlite3'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { MigrationProgress, MigrationResult } from '@shared/types'
import { getLibraryJsonPath, readConfig, updateConfig } from './config'
import { closeDatabase, readSchemaVersion } from '../db/client'
import { computeDirSize, precheckLibraryPath } from './precheck'
import { getActiveEntry, isUserDataPath, libraryDbPath, openLibrary } from './registry'

/** 迁移前后做行数校验的表（覆盖主链与记忆投影） */
const VERIFY_TABLES = [
  'project',
  'chapter_brief',
  'chapter_draft',
  'memory_chapter',
  'character',
  'outline_thread',
  'thread_event',
  'review',
  'pipeline_run',
  'provider',
  'llm_call'
]

const AUX_DIRS = ['backups', 'exports', 'covers']

export interface MigrateOptions {
  onProgress?: (progress: MigrationProgress) => void
  /** 允许中断；指针切换前中断不会产生半迁移状态 */
  signal?: AbortSignal
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('迁移已取消')
}

/**
 * 引导式迁移：把当前活动书库搬到 targetPath。
 * 关键点：VACUUM INTO 做一致快照（WAL 会被合并），校验通过后才原子切换指针。
 * 任一步失败即删除目标半成品并保持原指针不变（可回滚、可中断）。
 */
export function migrateActiveLibraryTo(targetPath: string, options: MigrateOptions = {}): MigrationResult {
  const { onProgress, signal } = options
  const report = (phase: MigrationProgress['phase'], message: string, percent: number): void => {
    onProgress?.({ phase, message, percent })
  }

  const sourceEntry = getActiveEntry()
  if (!sourceEntry) {
    return { ok: false, library: null, error: '当前没有活动书库，无法迁移', rolledBack: false }
  }

  const sourceDb = libraryDbPath(sourceEntry)
  const sourceRoot = sourceEntry.path
  const target = resolve(targetPath)

  if (!existsSync(sourceDb)) {
    return { ok: false, library: null, error: `源库文件不存在：${sourceDb}`, rolledBack: false }
  }
  if (resolve(sourceRoot) === target) {
    return { ok: false, library: null, error: '目标目录与当前书库相同，无需迁移', rolledBack: false }
  }
  if (isUserDataPath(target)) {
    return { ok: false, library: null, error: '目标不能是应用的配置目录，请另选位置', rolledBack: false }
  }

  // ---------- 预检 ----------
  report('precheck', '正在预检目标目录…', 5)
  const sourceBytes = computeDirSize(sourceRoot)
  const precheck = precheckLibraryPath(target, { sourceBytes })
  if (precheck.blockingError) {
    return { ok: false, library: null, error: precheck.blockingError, rolledBack: false }
  }
  if (precheck.hasDatabase) {
    return {
      ok: false,
      library: null,
      error: '目标目录已存在 inkwell.db。请改用其他目录，或直接在书库管理中「挂载」该库。',
      rolledBack: false
    }
  }

  const targetDb = join(target, 'inkwell.db')
  let createdTargetDir = false
  /** 指针是否已经切到目标：回滚时必须先把它恢复回源目录 */
  let pointerSwitched = false
  const migratedFlagBefore = readConfig().migratedFromUserData

  try {
    assertNotAborted(signal)
    if (!existsSync(target)) {
      mkdirSync(target, { recursive: true })
      createdTargetDir = true
    }

    // ---------- 一致快照 ----------
    report('vacuum', '正在生成一致快照（VACUUM INTO）…', 25)
    const sourceVersion = readSchemaVersion(sourceDb)
    closeDatabase()

    const src = new Database(sourceDb)
    try {
      src.pragma('wal_checkpoint(TRUNCATE)')
      src.exec(`VACUUM INTO '${escapeSql(targetDb)}'`)
    } finally {
      src.close()
    }

    assertNotAborted(signal)

    // ---------- 复制附属目录 ----------
    report('copy', '正在复制备份 / 导出 / 封面…', 55)
    for (const dir of AUX_DIRS) {
      const from = join(sourceRoot, dir)
      if (existsSync(from)) cpSync(from, join(target, dir), { recursive: true })
    }

    // ---------- 校验 ----------
    report('verify', '正在校验迁移结果…', 75)
    const verifyError = verifyMigration(sourceDb, targetDb, sourceVersion)
    if (verifyError) throw new Error(verifyError)

    assertNotAborted(signal)

    // ---------- 原子切指针（先改 config，再打开目标库并写 library.json） ----------
    report('switch', '正在切换书库指针…', 90)
    updateConfig((current) => {
      const entry = current.libraries.find((item) => item.id === sourceEntry.id)
      if (!entry) throw new Error('书库记录丢失，已放弃切换')
      entry.path = target
      entry.lastOpenedAt = Date.now()
      current.migratedFromUserData = true
    })
    pointerSwitched = true

    const info = openLibrary(sourceEntry.id)
    report('done', '迁移完成', 100)
    return { ok: true, library: info, error: '', rolledBack: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // 回滚顺序是关键：先把 config 指针恢复回源目录，再删除目标半成品，最后重开源库。
    // 若先删目标半成品，指针还指着 target，源库数据虽在、配置里却没有任何条目指向它，
    // 用户看到的会是「一本空书」甚至彻底没有数据库。
    if (pointerSwitched) {
      try {
        updateConfig((current) => {
          const entry = current.libraries.find((item) => item.id === sourceEntry.id)
          if (entry) {
            entry.path = sourceRoot
            entry.lastOpenedAt = Date.now()
          }
          current.migratedFromUserData = migratedFlagBefore
        })
      } catch {
        // 指针恢复失败也继续清理，但错误信息里已经带上原因
      }
    }

    // 删除目标半成品（此时指针已不再指向它）
    try {
      if (existsSync(targetDb)) rmSync(targetDb, { force: true })
      for (const dir of AUX_DIRS) {
        const aux = join(target, dir)
        if (existsSync(aux)) rmSync(aux, { recursive: true, force: true })
      }
      const jsonPath = getLibraryJsonPath(target)
      if (existsSync(jsonPath)) rmSync(jsonPath, { force: true })
      if (createdTargetDir && existsSync(target) && readdirSync(target).length === 0) {
        rmSync(target, { recursive: true, force: true })
      }
    } catch {
      // 清理失败不改变结论
    }
    try {
      closeDatabase()
      openLibrary(sourceEntry.id)
    } catch {
      // 源库重开失败（例如文件被占用），交由上层处理
    }

    report('done', `迁移失败：${message}`, 100)
    return { ok: false, library: null, error: message, rolledBack: true }
  }
}

/** 逐表比对行数 + integrity_check + schema 版本 */
function verifyMigration(sourceDb: string, targetDb: string, sourceVersion: number | null): string {
  const targetVersion = readSchemaVersion(targetDb)
  if (sourceVersion !== null && targetVersion !== null && targetVersion < sourceVersion) {
    return `目标库 schema 版本偏低（${targetVersion} < ${sourceVersion}）`
  }

  const src = new Database(sourceDb, { readonly: true })
  const dst = new Database(targetDb, { readonly: true })
  try {
    const integrity = dst.pragma('integrity_check', { simple: true }) as string
    if (integrity !== 'ok') return `目标库完整性校验失败：${integrity}`

    for (const table of VERIFY_TABLES) {
      const srcExists = tableExists(src, table)
      const dstExists = tableExists(dst, table)
      if (!srcExists && !dstExists) continue
      if (srcExists !== dstExists) return `表 ${table} 在目标库中缺失`
      const srcCount = countRows(src, table)
      const dstCount = countRows(dst, table)
      if (srcCount !== dstCount) return `表 ${table} 行数不一致（源 ${srcCount} / 目标 ${dstCount}）`
    }
    return ''
  } finally {
    src.close()
    dst.close()
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table))
}

function countRows(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }
  return row.c
}

/** 统计迁移所需字节数（供预检 UI） */
export function estimateMigrationBytes(): number {
  const entry = getActiveEntry()
  return entry ? computeDirSize(entry.path) : 0
}

/** 目标目录是否为「迁移半成品」（有 db 但无 library.json） */
export function looksLikePartialTarget(targetPath: string): boolean {
  try {
    const target = resolve(targetPath)
    const db = join(target, 'inkwell.db')
    if (!existsSync(db)) return false
    return !existsSync(getLibraryJsonPath(target)) && statSync(db).size > 0
  } catch {
    return false
  }
}