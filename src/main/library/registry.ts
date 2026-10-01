import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'
import { app } from 'electron'
import type { LibraryBootstrap, LibraryInfo, LibrarySettings } from '@shared/types'
import {
  getLegacyDbPath,
  newLibraryId,
  readConfig,
  readLibraryFile,
  updateConfig,
  writeLibraryFile,
  type AppConfig,
  type LibraryEntry
} from './config'
import {
  closeDatabase,
  getDatabasePath,
  initDatabase,
  isDatabaseOpen,
  latestSchemaVersion,
  readSchemaVersion
} from '../db/client'
import { needsDeleteJournal, precheckLibraryPath } from './precheck'

/** 书库数据库文件路径 */
export function libraryDbPath(entry: LibraryEntry): string {
  return join(entry.path, 'inkwell.db')
}

/** 最近一次启动解析结果（避免每次请求都重开数据库） */
let lastBootstrap: LibraryBootstrap | null = null

/** 当前活动书库根目录（备份 / 导出产物默认落点）；无库时退回 userData */
export function activeLibraryRoot(): string {
  const entry = getActiveEntry()
  return entry ? entry.path : app.getPath('userData')
}

export function getActiveEntry(): LibraryEntry | null {
  const config = readConfig()
  if (!config.activeLibraryId) return null
  return config.libraries.find((item) => item.id === config.activeLibraryId) ?? null
}

function toInfo(entry: LibraryEntry): LibraryInfo {
  const dbPath = libraryDbPath(entry)
  const available = existsSync(entry.path) && existsSync(dbPath)
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    createdAt: entry.createdAt,
    lastOpenedAt: entry.lastOpenedAt,
    schemaVersion: available ? readSchemaVersion(dbPath) : null,
    available
  }
}

export function listLibraries(): LibraryInfo[] {
  return readConfig().libraries.map(toInfo)
}

export function getSettings(): LibrarySettings {
  return readConfig().settings
}

export function saveSettings(patch: Partial<LibrarySettings>): LibrarySettings {
  const config = updateConfig((current) => {
    current.settings = { ...current.settings, ...patch }
  })
  return config.settings
}

/** 默认书库位置：优先 D 盘（若存在），否则「文档 / Inkwell 书库」 */
export function defaultLibraryRoot(): string {
  const preferred = process.platform === 'win32' ? 'D:\\Inkwell书库' : join(app.getPath('home'), 'Inkwell书库')
  try {
    if (process.platform === 'win32' && existsSync('D:\\')) return preferred
  } catch {
    // 忽略探测失败
  }
  return join(app.getPath('documents'), 'Inkwell 书库')
}

/** 在 config 中登记一个新条目 */
function registerEntry(config: AppConfig, name: string, path: string, id: string): LibraryEntry {
  const now = Date.now()
  const entry: LibraryEntry = { id, name, path: resolve(path), createdAt: now, lastOpenedAt: now }
  config.libraries.push(entry)
  config.activeLibraryId = id
  return entry
}

/** 打开指定书库（先关旧库、checkpoint，再开新库） */
export function openLibrary(id: string): LibraryInfo {
  const config = readConfig()
  const entry = config.libraries.find((item) => item.id === id)
  if (!entry) throw new Error(`书库不存在：${id}`)
  if (!existsSync(entry.path)) throw new Error(`书库目录不存在：${entry.path}`)

  const previousActiveId = config.activeLibraryId
  const reopen = (target: LibraryEntry): void => {
    initDatabase(libraryDbPath(target), {
      journalMode: needsDeleteJournal(target.path) ? 'DELETE' : 'WAL'
    })
  }

  closeDatabase()
  try {
    // R2：先把新库打开（含迁移）验证可用，再一次性原子切换 config 指针，
    // 最后才写 library.json —— library.json 只是元信息，写失败不影响可用性。
    reopen(entry)
    updateConfig((current) => {
      current.activeLibraryId = id
      const target = current.libraries.find((item) => item.id === id)
      if (target) target.lastOpenedAt = Date.now()
    })
    writeLibraryFile(entry.path, {
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
      schemaVersion: latestSchemaVersion()
    })
  } catch (error) {
    // 打开失败时不能留下「配置指向打不开的库」：先回到原来的活动库，再抛出。
    closeDatabase()
    const previous =
      previousActiveId && previousActiveId !== id
        ? config.libraries.find((item) => item.id === previousActiveId)
        : undefined
    if (previous && existsSync(libraryDbPath(previous))) {
      try {
        reopen(previous)
      } catch {
        closeDatabase()
      }
    }
    throw error
  }

  return toInfo({ ...entry, lastOpenedAt: Date.now() })
}

/** 新建书库：目录可不存在（会创建） */
export function createLibrary(input: { name: string; path: string }): LibraryInfo {
  const name = input.name.trim()
  if (!name) throw new Error('书库名称不能为空')
  const target = resolve(input.path)

  const dbPath = join(target, 'inkwell.db')
  const existing = readConfig().libraries.find((item) => resolve(item.path) === target)
  if (existing) throw new Error('该目录已登记为书库，请直接切换')

  const precheck = precheckLibraryPath(target, { forCreate: true, sourceBytes: 0 })
  if (precheck.blockingError) throw new Error(precheck.blockingError)
  if (existsSync(dbPath)) throw new Error('目标目录已存在 inkwell.db，请改用「挂载已有书库」')

  mkdirSync(target, { recursive: true })
  const id = newLibraryId()
  const previousActiveId = readConfig().activeLibraryId
  updateConfig((current) => {
    registerEntry(current, name, target, id)
  })
  try {
    openLibrary(id)
  } catch (error) {
    // 回滚登记：否则 config 里会留下一个指向打不开目录的僵尸书库
    updateConfig((current) => {
      current.libraries = current.libraries.filter((item) => item.id !== id)
      current.activeLibraryId = previousActiveId
    })
    const previous = previousActiveId
      ? readConfig().libraries.find((item) => item.id === previousActiveId)
      : undefined
    if (previous && existsSync(libraryDbPath(previous))) {
      try {
        openLibrary(previous.id)
      } catch {
        closeDatabase()
      }
    }
    throw error
  }
  return toInfo(readConfig().libraries.find((item) => item.id === id)!)
}

/** 挂载已有书库目录（必须已存在 inkwell.db） */
export function addLibrary(input: { name: string; path: string }): LibraryInfo {
  const target = resolve(input.path)
  const dbPath = join(target, 'inkwell.db')
  if (!existsSync(dbPath)) throw new Error('该目录下没有 inkwell.db，无法挂载')

  const meta = readLibraryFile(target)
  const name = input.name.trim() || meta?.name || '未命名书库'

  const duplicated = readConfig().libraries.find((item) => resolve(item.path) === target)
  if (duplicated) throw new Error('该目录已登记为书库，请直接切换')

  // library.json 里的 id 可能与本机另一本书库重名（常见于直接复制别人的书库目录）。
  // 若沿用同一个 id，登记会被跳过，随后 openLibrary 命中的是那本旧书——
  // 界面提示「挂载成功」，实际打开的是另一本书。这里改为分配新 id，
  // openLibrary 会把新 id 写回目标库的 library.json。
  const duplicatedId = Boolean(meta?.id) && readConfig().libraries.some((item) => item.id === meta?.id)
  const id = duplicatedId ? newLibraryId() : (meta?.id ?? newLibraryId())
  updateConfig((current) => {
    registerEntry(current, name, target, id)
  })
  openLibrary(id)
  return toInfo(readConfig().libraries.find((item) => item.id === id)!)
}

export function switchLibrary(id: string): { ok: boolean } {
  const entry = readConfig().libraries.find((item) => item.id === id)
  if (!entry) throw new Error(`书库不存在：${id}`)
  if (!existsSync(libraryDbPath(entry))) throw new Error(`书库文件缺失：${libraryDbPath(entry)}`)
  openLibrary(id)
  return { ok: true }
}

/** 库被移动/改名后重新指路 */
export function locateLibrary(input: { id: string; path: string }): LibraryInfo {
  const target = resolve(input.path)
  const dbPath = join(target, 'inkwell.db')
  if (!existsSync(dbPath)) throw new Error('所选目录下没有 inkwell.db')

  const duplicated = readConfig().libraries.find(
    (item) => item.id !== input.id && resolve(item.path) === target
  )
  if (duplicated) throw new Error(`该目录已登记为书库「${duplicated.name}」，请直接切换过去`)

  // R3：目录里的 library.json 若属于本机另一本书库，直接「定位」过去会把它
  // 的 id 覆写成当前条目的 id（等于偷走别人的库身份）。这里明确拒绝，
  // 请用户改用「挂载已有书库」。
  const meta = readLibraryFile(target)
  const foreignId =
    meta?.id && readConfig().libraries.some((item) => item.id === meta.id && item.id !== input.id)
  if (foreignId) {
    throw new Error('该目录的 library.json 属于本机另一个已登记的书库，请改用「挂载已有书库」')
  }

  updateConfig((current) => {
    const entry = current.libraries.find((item) => item.id === input.id)
    if (!entry) throw new Error(`书库不存在：${input.id}`)
    entry.path = target
    entry.lastOpenedAt = Date.now()
  })
  openLibrary(input.id)
  return toInfo(readConfig().libraries.find((item) => item.id === input.id)!)
}

/** 从列表移除；deleteFiles 为 true 时同时删除磁盘文件（有安全护栏） */
export function removeLibrary(input: { id: string; deleteFiles: boolean }): { ok: boolean } {
  const config = readConfig()
  const entry = config.libraries.find((item) => item.id === input.id)
  if (!entry) throw new Error(`书库不存在：${input.id}`)

  const wasActive = config.activeLibraryId === entry.id

  if (input.deleteFiles) {
    assertDeletable(entry.path)
    // Windows 上删除被打开的文件会 EBUSY/EPERM，还会留下删了一半的目录：
    // 删除活动库必须先关连接。
    if (wasActive) closeDatabase()
    rmSync(entry.path, { recursive: true, force: true })
  }

  const remaining = config.libraries.filter((item) => item.id !== entry.id)

  updateConfig((current) => {
    current.libraries = current.libraries.filter((item) => item.id !== entry.id)
    if (wasActive) {
      const next = remaining.find((item) => existsSync(libraryDbPath(item)))
      current.activeLibraryId = next?.id ?? null
    }
  })

  if (wasActive) {
    const next = readConfig().libraries.find((item) => existsSync(libraryDbPath(item)))
    if (next) openLibrary(next.id)
    else closeDatabase()
  }
  return { ok: true }
}

/** 删除书库文件的安全护栏：拒绝删 userData、盘符根、用户主目录 */
function assertDeletable(path: string): void {
  const normalized = normalize(resolve(path)).toLowerCase()
  const guards = [
    normalize(resolve(app.getPath('userData'))).toLowerCase(),
    normalize(resolve(app.getPath('home'))).toLowerCase(),
    'c:\\',
    'd:\\',
    normalize(resolve(app.getPath('documents'))).toLowerCase()
  ]
  if (guards.includes(normalized)) {
    throw new Error('为安全起见，不允许删除该目录')
  }
  if (normalized.length <= 4) throw new Error('为安全起见，不允许删除根目录')
}

export function renameLibrary(input: { id: string; name: string }): { ok: boolean } {
  const name = input.name.trim()
  if (!name) throw new Error('书库名称不能为空')
  const config = updateConfig((current) => {
    const entry = current.libraries.find((item) => item.id === input.id)
    if (!entry) throw new Error(`书库不存在：${input.id}`)
    entry.name = name
  })
  const entry = config.libraries.find((item) => item.id === input.id)!
  if (existsSync(entry.path)) {
    writeLibraryFile(entry.path, {
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
      schemaVersion: latestSchemaVersion()
    })
  }
  return { ok: true }
}

/** 放弃迁移引导：标记 migratedFromUserData，之后不再自动弹向导 */
export function dismissMigration(): void {
  updateConfig((current) => {
    current.migratedFromUserData = true
    current.migrationDismissed = true
  })
}

/** 迁移完成后清理 userData 里的旧库文件（数据库 + WAL/SHM），返回释放的字节数 */
export function purgeLegacyData(): { ok: boolean; freedBytes: number } {
  const dbPath = getLegacyDbPath()
  const active = getActiveEntry()
  // 安全护栏：活动库仍指向旧位置时不允许删除
  if (active && resolve(active.path) === resolve(dirname(dbPath))) {
    throw new Error('当前书库仍指向旧位置，无法清理')
  }
  let freedBytes = 0
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (!existsSync(file)) continue
      freedBytes += statSync(file).size
      rmSync(file, { force: true })
    } catch {
      // 单个文件删除失败不影响其他
    }
  }
  updateConfig((current) => {
    current.migratedFromUserData = true
    current.migrationDismissed = true
  })
  return { ok: true, freedBytes }
}

/**
 * 启动时解析书库：
 * 1) 首次升级且 userData 有旧库 → 登记为「默认书库」并提示迁移（不搬数据）
 * 2) 全新安装 → 自动在默认位置建库（0 门槛）
 * 3) 活动库失效 → 尽量回退到其他可用库（保证应用可用），并提示
 */
export function bootstrapLibraries(): LibraryBootstrap {
  const legacyDbPath = getLegacyDbPath()
  const legacyDbExists = existsSync(legacyDbPath)

  const config = readConfig()
  let needsAttention = false
  let attentionMessage = ''

  if (config.libraries.length === 0 && legacyDbExists) {
    // 情景 1：升级 —— 旧库原地登记为「默认书库」，绝不自动搬数据（只提示，由用户决定）
    const id = newLibraryId()
    const registered = updateConfig((current) => {
      if (current.libraries.length === 0) {
        registerEntry(current, '默认书库', app.getPath('userData'), id)
        current.migratedFromUserData = false
      }
    })
    try {
      const entry = registered.libraries.find((item) => item.id === id)
      if (entry) openLibrary(entry.id)
    } catch (error) {
      needsAttention = true
      attentionMessage = `打开旧书库失败：${errorMessage(error)}`
      closeDatabase()
    }
  } else if (config.libraries.length === 0) {
    // 情景 2：全新安装 —— 在默认位置建库并立即打开（0 门槛）。
    // 这里必须「建好并打开」，不能只登记条目：只登记不建库会让启动时报
    // 「找不到书库文件」的假故障，并留下一个永远「文件缺失」的僵尸书库。
    try {
      ensureLibraryAt(defaultLibraryRoot(), '我的书库')
    } catch {
      try {
        const target = join(app.getPath('userData'), 'library')
        mkdirSync(target, { recursive: true })
        ensureLibraryAt(target, '我的书库')
      } catch (fallbackError) {
        needsAttention = true
        attentionMessage = `无法创建书库：${errorMessage(fallbackError)}`
        closeDatabase()
      }
    }
  } else {
    // 情景 3：已有配置 —— 打开活动库；失效则先回退到其他可用库，再兜底重建
    const active =
      config.libraries.find((item) => item.id === config.activeLibraryId) ?? config.libraries[0]
    if (existsSync(libraryDbPath(active))) {
      try {
        openLibrary(active.id)
      } catch (error) {
        needsAttention = true
        attentionMessage = `打开书库失败：${errorMessage(error)}。已尝试切换到其他可用书库。`
        closeDatabase()
        // 活动库损坏时也要像「文件缺失」那样尝试其它库，否则用户会以「无数据库」状态启动
        const alternative = config.libraries.find(
          (item) => item.id !== active.id && existsSync(libraryDbPath(item))
        )
        if (alternative) {
          try {
            openLibrary(alternative.id)
          } catch {
            closeDatabase()
          }
        }
      }
    } else {
      needsAttention = true
      attentionMessage = `找不到书库文件：${libraryDbPath(active)}。可在「书库」页重新定位，或挂载其他书库。`
      const fallback = config.libraries.find(
        (item) => item.id !== active.id && existsSync(libraryDbPath(item))
      )
      if (fallback) {
        try {
          openLibrary(fallback.id)
        } catch {
          closeDatabase()
        }
      } else {
        try {
          ensureLibraryAt(defaultLibraryRoot(), '我的书库')
        } catch {
          try {
            const target = join(app.getPath('userData'), 'library')
            mkdirSync(target, { recursive: true })
            ensureLibraryAt(target, '我的书库')
          } catch {
            closeDatabase()
          }
        }
      }
    }
  }

  const refreshed = readConfig()
  const result: LibraryBootstrap = {
    activeLibraryId: refreshed.activeLibraryId,
    libraries: listLibraries(),
    needsAttention,
    attentionMessage,
    pendingMigration:
      legacyDbExists &&
      !refreshed.migratedFromUserData &&
      !refreshed.migrationDismissed &&
      isLegacyActive(refreshed),
    legacyDbPath: legacyDbExists ? legacyDbPath : null,
    legacyDbExists,
    databasePath: isDatabaseOpen() ? getDatabasePath() : ''
  }
  lastBootstrap = result
  if (needsAttention) console.warn(`[inkwell] library attention: ${attentionMessage}`)
  return result
}

/**
 * 打开（必要时创建）指定路径的书库。
 * 目录已登记但库文件缺失时直接打开该条目（openLibrary 会重建数据库文件），
 * 避免「登记了条目却没有库文件」的僵尸书库。
 */
function ensureLibraryAt(path: string, name: string): LibraryInfo {
  const target = resolve(path)
  const registered = readConfig().libraries.find((item) => resolve(item.path) === target)
  if (registered) {
    if (!existsSync(libraryDbPath(registered))) {
      console.warn(`[inkwell] library file missing, recreating: ${libraryDbPath(registered)}`)
    }
    return openLibrary(registered.id)
  }
  if (existsSync(join(target, 'inkwell.db'))) return addLibrary({ name, path: target })
  return createLibrary({ name, path: target })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 读取当前书库状态（不重开数据库）。
 * 渲染进程每次进入设置页都调用，必须廉价且无副作用；
 * needsAttention 按「当前」状态实时判定，用户在书库页修好后警告立即消失。
 */
export function getBootstrapState(): LibraryBootstrap {
  if (!lastBootstrap) return bootstrapLibraries()
  const config = readConfig()
  const active = getActiveEntry()
  const dbOpen = isDatabaseOpen()
  const activeMissing = active ? !existsSync(libraryDbPath(active)) : false
  const attention = !dbOpen || activeMissing
  const legacyDbPath = getLegacyDbPath()
  const legacyDbExists = existsSync(legacyDbPath)
  return {
    activeLibraryId: active?.id ?? null,
    libraries: listLibraries(),
    databasePath: dbOpen ? getDatabasePath() : '',
    needsAttention: attention,
    attentionMessage: attention ? lastBootstrap.attentionMessage : '',
    // 这三项必须按「当前」状态重算：否则迁移成功或点了「暂不迁移」之后，
    // 每次进书库页都会因为沿用了启动瞬间的旧值而重新弹出迁移向导，
    // 清理完旧数据后「旧版数据」卡片也不会消失。
    pendingMigration:
      legacyDbExists &&
      !config.migratedFromUserData &&
      !config.migrationDismissed &&
      isLegacyActive(config),
    legacyDbPath: legacyDbExists ? legacyDbPath : null,
    legacyDbExists
  }
}

function isLegacyActive(config: AppConfig): boolean {
  const entry = config.libraries.find((item) => item.id === config.activeLibraryId)
  if (!entry) return false
  return resolve(entry.path) === resolve(dirname(getLegacyDbPath()))
}

/** 判断某路径是否为 userData（迁移目标不能是旧库自身） */
export function isUserDataPath(path: string): boolean {
  return resolve(path) === resolve(app.getPath('userData'))
}