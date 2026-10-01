import { closeDatabase, isDatabaseOpen } from './db/client'

/**
 * 统一资源登记与优雅退出（M6）。
 * 退出时按固定顺序回收：拒绝新写入 → 中断在途请求 → 清定时器 → checkpoint → 关库。
 */

type Cleanup = () => void | Promise<void>

const aborters = new Set<AbortController>()
const timers = new Set<ReturnType<typeof setInterval>>()
const cleanups = new Set<Cleanup>()

let quitting = false
let shutdownPromise: Promise<void> | null = null

/** 是否正在退出（退出中一律拒绝新的写操作） */
export function isQuitting(): boolean {
  return quitting
}

/** 登记一个可中断的在途请求 */
export function registerAborter(controller: AbortController): void {
  aborters.add(controller)
}

export function unregisterAborter(controller: AbortController): void {
  aborters.delete(controller)
}

/** 中断所有在途 LLM 请求 / 长任务 */
export function abortAll(): number {
  const count = aborters.size
  for (const controller of aborters) {
    try {
      controller.abort()
    } catch {
      // 单个中断失败不影响其他
    }
  }
  aborters.clear()
  return count
}

/** 登记定时器（退出时统一 clear） */
export function registerInterval(handler: () => void, ms: number): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    if (quitting) return
    try {
      handler()
    } catch (error) {
      console.error('[inkwell] interval handler failed:', error)
    }
  }, ms)
  // 不阻止进程退出
  timer.unref?.()
  timers.add(timer)
  return timer
}

/** 登记一次性清理回调 */
export function registerCleanup(cleanup: Cleanup): void {
  cleanups.add(cleanup)
}

/**
 * 优雅退出（before-quit 调用）。
 * 顺序：拒绝新写入 → 中断在途 → 清定时器 → 清自定义资源 → checkpoint+关库。
 */
export function gracefulShutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise

  shutdownPromise = (async () => {
    quitting = true

    // 2) 中断所有在途请求（连写 / 生成 / 向导）——中断会把断点写回 pipeline_step
    abortAll()

    // 3) 回收定时器
    for (const timer of timers) clearInterval(timer)
    timers.clear()

    // 4) 自定义清理（MCP 子进程、文件句柄等）
    for (const cleanup of cleanups) {
      try {
        await cleanup()
      } catch (error) {
        console.error('[inkwell] cleanup failed:', error)
      }
    }
    cleanups.clear()

    // 5) checkpoint + 关库（closeDatabase 内部会 TRUNCATE WAL）
    if (isDatabaseOpen()) closeDatabase()
  })()

  return shutdownPromise
}