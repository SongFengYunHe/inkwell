import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { BackupInfo } from '@shared/types'
import { activeLibraryRoot, getActiveEntry, getSettings, openLibrary } from '../library/registry'
import { closeDatabase, vacuumInto } from './client'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 备份文件命名：inkwell-YYYYMMDD-HHMMSS-<reason>.db
 * reason 允许数字：迁移前快照叫 pre-migrate-v7（含版本号），
 * 早年用 [a-z-]+ 会把它排除在列表 / 轮转 / 恢复之外，长期只增不减。
 */
const BACKUP_RE = /^inkwell-(\d{8})-(\d{6})-([a-z0-9-]+)\.db$/

function backupsDir(): string {
  return join(activeLibraryRoot(), 'backups')
}

function stamp(now = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** 生成一个未被占用的备份文件名（同一秒内多次备份时向后顺延） */
function allocateBackupName(dir: string, reason: string): { name: string; target: string } {
  let at = Date.now()
  for (let guard = 0; guard < 120; guard += 1) {
    const name = `inkwell-${stamp(at)}-${reason}.db`
    const target = join(dir, name)
    if (!existsSync(target)) return { name, target }
    at += 1000
  }
  throw new Error('备份文件命名冲突过多，请稍后重试')
}

function parseCreatedAt(name: string): number {
  const match = BACKUP_RE.exec(name)
  if (!match) return 0
  const [, date, time] = match
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`
  const ts = Date.parse(iso)
  return Number.isNaN(ts) ? 0 : ts
}

/** 立即生成一份备份（VACUUM INTO，WAL 会被合并） */
export function createBackup(reason = 'manual'): BackupInfo {
  const entry = getActiveEntry()
  if (!entry) throw new Error('当前没有活动书库，无法备份')

  const dir = backupsDir()
  mkdirSync(dir, { recursive: true })
  // 同一秒内连续备份会撞名，而 VACUUM INTO 拒绝已存在的目标文件；
  // 向后顺延秒数直到拿到未占用的文件名。
  const { name, target } = allocateBackupName(dir, reason)

  vacuumInto(target)
  rotateBackups()

  const info = toInfo(dir, name)
  return info ?? { name, path: target, bytes: statSync(target).size, createdAt: Date.now(), reason }
}

function toInfo(dir: string, name: string): BackupInfo | null {
  const path = join(dir, name)
  if (!existsSync(path)) return null
  const match = BACKUP_RE.exec(name)
  return {
    name,
    path,
    bytes: statSync(path).size,
    createdAt: parseCreatedAt(name),
    reason: match?.[3] ?? 'unknown'
  }
}

export function listBackups(): BackupInfo[] {
  const dir = backupsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => BACKUP_RE.test(name))
    .map((name) => toInfo(dir, name))
    .filter((item): item is BackupInfo => item !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 轮转策略：保留最近 10 份 + 每天 1 份保留 7 天 + 每周 1 份保留 4 周。
 * 未命中任何保留规则的旧备份会被删除。
 */
export function rotateBackups(): number {
  const all = listBackups()
  const now = Date.now()
  const keep = new Set<string>()

  // 最近 10 份无条件保留
  all.slice(0, 10).forEach((item) => keep.add(item.name))

  const dailySeen = new Set<string>()
  const weeklySeen = new Set<string>()
  for (const item of all) {
    const age = now - item.createdAt
    const day = new Date(item.createdAt)
    const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
    if (age <= 7 * DAY_MS && !dailySeen.has(dayKey)) {
      dailySeen.add(dayKey)
      keep.add(item.name)
      continue
    }
    if (age <= 28 * DAY_MS) {
      const weekKey = `${day.getFullYear()}-${Math.floor((day.getMonth() * 31 + day.getDate()) / 7)}`
      if (!weeklySeen.has(weekKey)) {
        weeklySeen.add(weekKey)
        keep.add(item.name)
      }
    }
  }

  let removed = 0
  for (const item of all) {
    if (keep.has(item.name)) continue
    try {
      rmSync(item.path, { force: true })
      removed += 1
    } catch {
      // 单份删除失败不影响其他
    }
  }
  return removed
}

/** 删除某份备份 */
export function deleteBackup(name: string): void {
  const safeName = basename(name)
  if (!BACKUP_RE.test(safeName)) throw new Error('备份文件名不合法')
  const path = join(backupsDir(), safeName)
  if (existsSync(path)) rmSync(path, { force: true })
}

/** 校验一个 SQLite 文件能否打开且结构完整；返回空串表示没问题 */
function checkSqliteFile(path: string): string {
  let probe: Database.Database | null = null
  try {
    probe = new Database(path, { readonly: true, fileMustExist: true })
    const result = probe.pragma('integrity_check', { simple: true }) as string
    return result === 'ok' ? '' : `完整性校验失败：${result}`
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    probe?.close()
  }
}

/**
 * 恢复某份备份；恢复前自动先把当前库备份一份（防误操作）。
 * 关键：不是「直接覆盖」——
 *   1) 先校验备份文件本身可用；
 *   2) 复制到同目录 .tmp 并再校验一次，通过后 rename 原子替换（避免半截文件）；
 *   3) 恢复后打不开时，自动用刚才的保护备份还原回恢复前的状态。
 */
export function restoreBackup(name: string): { ok: boolean } {
  const entry = getActiveEntry()
  if (!entry) throw new Error('当前没有活动书库，无法恢复')

  const safeName = basename(name)
  if (!BACKUP_RE.test(safeName)) throw new Error('备份文件名不合法')
  const from = join(backupsDir(), safeName)
  if (!existsSync(from)) throw new Error(`备份不存在：${safeName}`)

  const problem = checkSqliteFile(from)
  if (problem) throw new Error(`该备份不可用（${problem}），已取消恢复，当前书库未做任何改动`)

  // 1) 保护当前库（同时作为自动还原的来源）
  const guard = createBackup('pre-restore')

  const dbPath = join(entry.path, 'inkwell.db')
  const tmp = `${dbPath}.restore-tmp`

  // 2) 关连接 → 复制到临时文件 → 校验 → 原子替换
  closeDatabase()
  try {
    copyFileSync(from, tmp)
    const tmpProblem = checkSqliteFile(tmp)
    if (tmpProblem) throw new Error(`恢复副本校验失败：${tmpProblem}`)
    for (const suffix of ['-wal', '-shm']) {
      const side = `${dbPath}${suffix}`
      if (existsSync(side)) rmSync(side, { force: true })
    }
    renameSync(tmp, dbPath)
  } catch (error) {
    try {
      if (existsSync(tmp)) rmSync(tmp, { force: true })
    } catch {
      // 清理临时文件失败不影响结论
    }
    try {
      openLibrary(entry.id)
    } catch {
      // 交回给上层：错误信息里会说明目标备份仍可用
    }
    throw error
  }

  // 3) 重新打开；失败就用保护备份把库还原回去，绝不让用户只剩一个打不开的库
  try {
    openLibrary(entry.id)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      closeDatabase()
      copyFileSync(guard.path, dbPath)
      for (const suffix of ['-wal', '-shm']) {
        const side = `${dbPath}${suffix}`
        if (existsSync(side)) rmSync(side, { force: true })
      }
      openLibrary(entry.id)
    } catch {
      throw new Error(`恢复后打开书库失败，且自动还原也未成功：${message}。恢复前的备份已保留：${guard.path}`)
    }
    throw new Error(`恢复后打开书库失败，已自动还原为恢复前的状态：${message}`)
  }
}

/** 备份目录的绝对路径（供 UI 打开所在目录） */
export function backupsDirPath(): string {
  return backupsDir()
}

/** 是否应当做自动备份（用户可在设置中关闭） */
export function autoBackupEnabled(): boolean {
  return getSettings().autoBackup
}