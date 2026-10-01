import Database from 'better-sqlite3'
import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { MigrationProgress } from '@shared/types'
import { readSchemaVersion } from '../db/client'

/**
 * R1：迁移的「重活」部分（一致快照 + 复制附属目录 + 校验）。
 *
 * 这个文件**不许 import electron**：它同时被主进程（inline 兜底路径）和
 * utilityProcess 子进程（migrate-worker.ts）复用，子进程里没有 app / BrowserWindow。
 */

export const AUX_DIRS = ['backups', 'exports', 'covers']

/** 迁移前后做行数校验的表（覆盖主链与记忆投影） */
export const VERIFY_TABLES = [
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
  'llm_call',
  'volume',
  'draft_revision',
  'prompt_template'
]

export type ProgressReporter = (phase: MigrationProgress['phase'], message: string, percent: number) => void

export interface HeavyMigrationContext {
  sourceDb: string
  sourceRoot: string
  /** 目标书库根目录（必须已存在） */
  target: string
  onProgress?: ProgressReporter
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}

/** 目录体积（字节）；失败返回 0 */
export function countRowsSafe(db: Database.Database, table: string): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM "' + table + '"').get() as { c: number }
  return row.c
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))
}

/** 逐表比对行数 + integrity_check + schema 版本；返回空串表示通过 */
export function verifyMigration(sourceDb: string, targetDb: string, sourceVersion: number | null): string {
  const targetVersion = readSchemaVersion(targetDb)
  if (sourceVersion !== null && targetVersion !== null && targetVersion < sourceVersion) {
    return '目标库 schema 版本偏低（' + targetVersion + ' < ' + sourceVersion + '）'
  }

  const src = new Database(sourceDb, { readonly: true })
  const dst = new Database(targetDb, { readonly: true })
  try {
    const integrity = dst.pragma('integrity_check', { simple: true }) as string
    if (integrity !== 'ok') return '目标库完整性校验失败：' + integrity

    for (const table of VERIFY_TABLES) {
      const srcExists = tableExists(src, table)
      const dstExists = tableExists(dst, table)
      if (!srcExists && !dstExists) continue
      if (srcExists !== dstExists) return '表 ' + table + ' 在目标库中缺失'
      const srcCount = countRowsSafe(src, table)
      const dstCount = countRowsSafe(dst, table)
      if (srcCount !== dstCount) return '表 ' + table + ' 行数不一致（源 ' + srcCount + ' / 目标 ' + dstCount + '）'
    }
    return ''
  } finally {
    src.close()
    dst.close()
  }
}

/**
 * 执行重活。抛出异常即代表迁移失败，调用方负责回滚（删目标半成品 + 恢复指针）。
 * 全程同步：这是设计上的取舍——它要么跑在主进程的 inline 兜底路径，
 * 要么跑在 utilityProcess 子进程里（默认路径），不会阻塞界面。
 */
export function runHeavyMigration(ctx: HeavyMigrationContext): void {
  const targetDb = join(ctx.target, 'inkwell.db')

  ctx.onProgress?.('vacuum', '正在生成一致快照（VACUUM INTO）…', 25)
  const sourceVersion = readSchemaVersion(ctx.sourceDb)
  const src = new Database(ctx.sourceDb)
  try {
    src.pragma('wal_checkpoint(TRUNCATE)')
    src.exec("VACUUM INTO '" + escapeSql(targetDb) + "'")
  } finally {
    src.close()
  }

  ctx.onProgress?.('copy', '正在复制备份 / 导出 / 封面…', 55)
  for (const dir of AUX_DIRS) {
    const from = join(ctx.sourceRoot, dir)
    if (existsSync(from)) cpSync(from, join(ctx.target, dir), { recursive: true })
  }

  ctx.onProgress?.('verify', '正在校验迁移结果…', 75)
  const verifyError = verifyMigration(ctx.sourceDb, targetDb, sourceVersion)
  if (verifyError) throw new Error(verifyError)
}
