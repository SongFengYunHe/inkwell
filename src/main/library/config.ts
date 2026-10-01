import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { LibrarySettings } from '@shared/types'

/**
 * config.json —— 应用配置与书库指针，固定落在 userData。
 * 指针本身必须有稳定落点，否则「先有鸡还是先有蛋」。
 */

export interface LibraryEntry {
  id: string
  name: string
  /** 书库根目录（inkwell.db / backups / exports / covers 所在处） */
  path: string
  createdAt: number
  lastOpenedAt: number
}

export interface AppConfig {
  version: 1
  activeLibraryId: string | null
  libraries: LibraryEntry[]
  /** 是否已从 userData 旧位置迁移（迁移向导展示后置 true） */
  migratedFromUserData: boolean
  /** 用户选择「暂不迁移」，之后不再自动弹出向导 */
  migrationDismissed: boolean
  settings: LibrarySettings
}

export const DEFAULT_SETTINGS: LibrarySettings = {
  trashRetentionDays: 30,
  cleanCacheOnQuit: false,
  autoBackup: true,
  // A3：向量检索默认关闭（会消耗 embedding 额度，需用户显式开启）
  ragSearch: false,
  // A4：只自动「检查」更新并提示，不自动下载或安装
  autoUpdate: true
}

/** config.json 绝对路径（userData 固定目录） */
export function getConfigPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** 旧版数据库位置（M5 及以前），迁移的来源 */
export function getLegacyDbPath(): string {
  return join(app.getPath('userData'), 'inkwell.db')
}

/** 书库内的元信息文件 */
export function getLibraryJsonPath(libraryRoot: string): string {
  return join(libraryRoot, 'library.json')
}

export interface LibraryFile {
  id: string
  name: string
  createdAt: number
  schemaVersion: number
}

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    activeLibraryId: null,
    libraries: [],
    migratedFromUserData: false,
    migrationDismissed: false,
    settings: { ...DEFAULT_SETTINGS }
  }
}

/** 读取配置；损坏时备份原文件并回退默认值，绝不因此崩溃 */
export function readConfig(): AppConfig {
  const path = getConfigPath()
  if (!existsSync(path)) return defaultConfig()

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppConfig>
    const base = defaultConfig()
    return {
      version: 1,
      activeLibraryId: typeof raw.activeLibraryId === 'string' ? raw.activeLibraryId : null,
      libraries: Array.isArray(raw.libraries)
        ? raw.libraries.filter(isLibraryEntry).map((item) => ({ ...item }))
        : [],
      migratedFromUserData: raw.migratedFromUserData === true,
      migrationDismissed: raw.migrationDismissed === true,
      settings: { ...base.settings, ...(raw.settings ?? {}) }
    }
  } catch {
    try {
      copyFileSync(path, `${path}.corrupt-${Date.now()}`)
    } catch {
      // 备份失败不影响回退
    }
    return defaultConfig()
  }
}

function isLibraryEntry(value: unknown): value is LibraryEntry {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && typeof item.name === 'string' && typeof item.path === 'string'
}

/** 原子写入配置：先写 .tmp 再 rename，避免断电产生半截文件 */
export function writeConfig(config: AppConfig): void {
  const path = getConfigPath()
  const dir = join(path, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8')
  renameSync(tmp, path)
}

/** 读取配置 → 变更 → 原子写回 */
export function updateConfig(mutator: (config: AppConfig) => void): AppConfig {
  const config = readConfig()
  mutator(config)
  writeConfig(config)
  return config
}

/** 生成书库 id */
export function newLibraryId(): string {
  return `lib_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

/** 读取书库元信息（library.json） */
export function readLibraryFile(libraryRoot: string): LibraryFile | null {
  const path = getLibraryJsonPath(libraryRoot)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LibraryFile>
    if (typeof raw.id !== 'string') return null
    return {
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : '未命名书库',
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0
    }
  } catch {
    return null
  }
}

/** 写入书库元信息 */
export function writeLibraryFile(libraryRoot: string, file: LibraryFile): void {
  writeFileSync(getLibraryJsonPath(libraryRoot), JSON.stringify(file, null, 2), 'utf8')
}