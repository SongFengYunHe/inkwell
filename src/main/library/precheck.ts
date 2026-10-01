import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs'
import { dirname, isAbsolute, join, parse } from 'node:path'
import type { LibraryPrecheck } from '@shared/types'

/** 已知同步盘目录名特征（SQLite WAL 在网络同步盘上会损坏） */
const SYNC_HINTS: Array<{ match: RegExp; name: string }> = [
  { match: /onedrive/i, name: 'OneDrive' },
  { match: /dropbox/i, name: 'Dropbox' },
  { match: /google\s*drive|googledrive/i, name: 'Google Drive' },
  { match: /jianguoyun|坚果云/i, name: '坚果云' },
  { match: /icloud/i, name: 'iCloud' },
  { match: /box\s*sync|boxdrive/i, name: 'Box' },
  { match: /nutstore/i, name: '坚果云' }
]

export function detectSyncProvider(path: string): string | null {
  for (const hint of SYNC_HINTS) {
    if (hint.match.test(path)) return hint.name
  }
  // 环境变量兜底：同步盘常把库放在 %OneDrive% 等目录下
  for (const [envKey, name] of [
    ['OneDrive', 'OneDrive'],
    ['OneDriveConsumer', 'OneDrive'],
    ['OneDriveCommercial', 'OneDrive']
  ] as const) {
    const root = process.env[envKey]
    if (root && isInside(path, root)) return name
  }
  return null
}

function isInside(child: string, parent: string): boolean {
  const normalizedChild = child.replace(/\//g, '\\').toLowerCase()
  const normalizedParent = parent.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, '')
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}\\`)
}

/** UNC 路径（\\server\share）或映射网络盘 */
export function detectNetworkPath(path: string): boolean {
  if (/^[\\/]{2}[^\\/]/.test(path)) return true

  const root = parse(path).root
  if (!root) return false

  if (process.platform === 'win32' && /^[a-zA-Z]:\\$/.test(root)) {
    try {
      const out = execFileSync('fsutil', ['fsinfo', 'drivetype', root], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 2_000
      })
      return /Remote|网络/i.test(out)
    } catch {
      return false
    }
  }
  return false
}

/** 探测可用空间（字节）；失败返回 null */
export function probeFreeBytes(path: string): number | null {
  try {
    const stats = statfsSync(path)
    return Number(stats.bsize) * Number(stats.bavail)
  } catch {
    return null
  }
}

/** 递归统计目录体积（字节），跳过符号链接，深度受限以防失控 */
export function computeDirSize(path: string, depth = 0): number {
  if (depth > 8 || !existsSync(path)) return 0
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    try {
      if (entry.isDirectory()) total += computeDirSize(full, depth + 1)
      else if (entry.isFile()) total += statSync(full).size
    } catch {
      // 单个条目失败不影响整体估算
    }
  }
  return total
}

export interface PrecheckOptions {
  /** 源库大小（迁移时用于估算所需空间，默认取目标自身大小） */
  sourceBytes?: number
  /** 允许目标目录为空（新建库场景）；默认 false 时仅提示不阻断 */
  forCreate?: boolean
}

/**
 * 目录预检：可写性 / 存量库 / 同步盘 / 网络盘 / 空间。
 * 返回 blockingError 非空表示应阻止操作；warnings 表示强警告但可继续。
 */
export function precheckLibraryPath(targetPath: string, options: PrecheckOptions = {}): LibraryPrecheck {
  const warnings: string[] = []
  let blockingError = ''

  const exists = existsSync(targetPath)
  const dbPath = join(targetPath, 'inkwell.db')
  const hasDatabase = exists && existsSync(dbPath)

  // 可写性：目录不存在则检查其可创建的父目录
  let writable = false
  try {
    const probeTarget = exists ? targetPath : nearestExisting(dirname(targetPath))
    if (probeTarget) {
      const mode = statSync(probeTarget).mode
      // 无写位（0o200）粗判；真正写入失败会在落盘时报错
      writable = (mode & 0o200) !== 0
    }
  } catch {
    writable = false
  }
  if (!writable) blockingError = '目标目录不可写，请选择其他位置'

  const syncProvider = detectSyncProvider(targetPath)
  if (syncProvider) {
    warnings.push(
      `检测到 ${syncProvider} 同步目录：SQLite 的 WAL 日志在同步盘上容易损坏，已自动降级为 DELETE 日志模式，仍建议改用本地磁盘。`
    )
  }

  const networkPath = detectNetworkPath(targetPath)
  if (networkPath) {
    warnings.push('检测到 UNC 路径或映射网络盘：同样会降级为 DELETE 日志模式，建议改用本地磁盘。')
  }

  if (hasDatabase && !options.forCreate) {
    warnings.push('目标目录已存在 inkwell.db，可直接「挂载」该库，或改用其他目录。')
  }

  const sourceBytes = options.sourceBytes ?? computeDirSize(targetPath)
  const freeBytes = probeFreeBytes(exists ? targetPath : nearestExisting(dirname(targetPath)) ?? targetPath)
  if (freeBytes !== null && sourceBytes > 0 && freeBytes < sourceBytes * 2.5) {
    blockingError = `磁盘可用空间不足：需要约 ${formatBytes(sourceBytes * 2.5)}，当前仅 ${formatBytes(freeBytes)}`
  }

  return {
    path: targetPath,
    writable,
    hasDatabase,
    syncProvider,
    networkPath,
    freeBytes,
    sourceBytes,
    blockingError,
    warnings
  }
}

function nearestExisting(path: string): string | null {
  let current = path
  for (let i = 0; i < 20; i += 1) {
    if (existsSync(current)) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}

/** 该目录是否需要降级 journal 模式（同步盘 / 网络盘） */
export function needsDeleteJournal(path: string): boolean {
  return detectSyncProvider(path) !== null || detectNetworkPath(path)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

/** 路径是否为绝对路径（IPC 入参校验用） */
export function isAbsolutePath(path: string): boolean {
  return isAbsolute(path)
}