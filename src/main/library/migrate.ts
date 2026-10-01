import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { MigrationProgress, MigrationResult } from '@shared/types'
import { getLibraryJsonPath, readConfig, updateConfig } from './config'
import { closeDatabase } from '../db/client'
import { computeDirSize, precheckLibraryPath } from './precheck'
import { AUX_DIRS, runHeavyMigration } from './migrate-heavy'
import { getActiveEntry, isUserDataPath, libraryDbPath, openLibrary } from './registry'

export interface MigrateOptions {
  onProgress?: (progress: MigrationProgress) => void
  /** 允许中断；指针切换前中断不会产生半迁移状态 */
  signal?: AbortSignal
}

/** 正在进行的迁移（供「取消迁移」使用） */
let activeMigration: { controller: AbortController; child: UtilityProcess | null } | null = null

/** R1：取消正在进行的迁移。杀掉子进程即可——指针从未被改过，目标半成品由回滚清理。 */
export function cancelActiveMigration(): { ok: boolean } {
  if (!activeMigration) return { ok: false }
  const { controller, child } = activeMigration
  try {
    controller.abort()
  } catch {
    // 忽略
  }
  try {
    child?.kill()
  } catch {
    // 忽略
  }
  return { ok: true }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('迁移已取消')
}

/**
 * 在 utilityProcess 里跑重活；拿不到子进程入口时返回 false，由调用方走 inline 兜底。
 */
function runHeavyInWorker(ctx: {
  sourceDb: string
  sourceRoot: string
  target: string
  signal?: AbortSignal
  report: (phase: MigrationProgress['phase'], message: string, percent: number) => void
}): Promise<boolean> {
  const workerPath = join(__dirname, 'migrate-worker.js')
  if (!existsSync(workerPath)) return Promise.resolve(false)

  let child: UtilityProcess
  try {
    child = utilityProcess.fork(workerPath, [], { serviceName: 'inkwell-migrate' })
  } catch {
    return Promise.resolve(false)
  }

  const controller = new AbortController()
  activeMigration = { controller, child }

  return new Promise<boolean>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      activeMigration = null
      try {
        child.kill()
      } catch {
        // 已经退出
      }
    }
    const settle = (outcome: boolean | Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (outcome instanceof Error) reject(outcome)
      else resolve(outcome)
    }

    child.on('message', (message: unknown) => {
      const payload = message as { type?: string; phase?: string; message?: string; percent?: number }
      if (payload?.type === 'progress') {
        ctx.report(
          (payload.phase ?? 'copy') as MigrationProgress['phase'],
          payload.message ?? '',
          payload.percent ?? 0
        )
        return
      }
      if (payload?.type === 'done') {
        settle(true)
        return
      }
      if (payload?.type === 'error') {
        settle(new Error(payload.message || '迁移子进程报错'))
      }
    })

    child.on('exit', (code: number) => {
      if (settled) return
      // 取消时 controller 已 abort：给出「已取消」而不是晦涩的退出码
      settle(controller.signal.aborted ? new Error('迁移已取消') : new Error('迁移子进程异常退出（code=' + code + '）'))
    })

    if (ctx.signal) {
      if (ctx.signal.aborted) {
        settle(new Error('迁移已取消'))
        return
      }
      ctx.signal.addEventListener(
        'abort',
        () => {
          controller.abort()
          try {
            child.kill()
          } catch {
            // 已退出
          }
        },
        { once: true }
      )
    }

    try {
      child.postMessage({
        type: 'start',
        sourceDb: ctx.sourceDb,
        sourceRoot: ctx.sourceRoot,
        target: ctx.target
      })
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/**
 * 引导式迁移：把当前活动书库搬到 targetPath。
 *
 * R1 起重活（VACUUM INTO / 复制附属目录 / 校验）默认跑在 utilityProcess 子进程里，
 * 主进程只负责预检、进度转发、指针原子切换与失败回滚，因此界面不会假死，且可随时取消。
 * 拿不到子进程入口时自动退回 inline 同步实现（行为与旧版完全一致）。
 */
export async function migrateActiveLibraryTo(
  targetPath: string,
  options: MigrateOptions = {}
): Promise<MigrationResult> {
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
    return { ok: false, library: null, error: '源库文件不存在：' + sourceDb, rolledBack: false }
  }
  if (resolve(sourceRoot) === target) {
    return { ok: false, library: null, error: '目标目录与当前书库相同，无需迁移', rolledBack: false }
  }
  if (isUserDataPath(target)) {
    return { ok: false, library: null, error: '目标不能是应用的配置目录，请另选位置', rolledBack: false }
  }

  // ---------- 预检（主进程，快速） ----------
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

    // 关掉主进程连接：让子进程的 WAL checkpoint 拿到独占（inline 路径同样需要）
    closeDatabase()

    const inline = process.env.INKWELL_MIGRATE_INLINE === '1'
    const usedWorker = inline
      ? false
      : await runHeavyInWorker({ sourceDb, sourceRoot, target, signal, report })

    if (!usedWorker) {
      report('vacuum', '正在生成一致快照（VACUUM INTO）…', 25)
      runHeavyMigration({
        sourceDb,
        sourceRoot,
        target,
        onProgress: (phase, message, percent) => report(phase, message, percent)
      })
    }

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

    report('done', '迁移失败：' + message, 100)
    return { ok: false, library: null, error: message, rolledBack: true }
  }
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
