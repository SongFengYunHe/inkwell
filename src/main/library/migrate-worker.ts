/**
 * R1：迁移子进程入口（utilityProcess.fork 拉起）。
 *
 * 它只做重活，不碰 config.json（指针切换永远留在主进程），
 * 因此「取消」只需杀掉本进程：目标半成品由主进程回滚，指针从未被改过。
 */
import { runHeavyMigration } from './migrate-heavy'

/** process.parentPort 的最小类型（避免 import electron —— 子进程里用不到它） */
interface ParentPortLike {
  on(event: 'message', listener: (messageEvent: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

interface StartMessage {
  type: 'start'
  sourceDb: string
  sourceRoot: string
  target: string
}

const port = (process as unknown as { parentPort?: ParentPortLike }).parentPort

if (!port) {
  // 不是被 utilityProcess 拉起的（例如有人手动 node 跑它）——直接退出，避免静默挂住
  process.exit(2)
} else {
  port.on('message', (event) => {
    const message = event.data as StartMessage | undefined
    if (!message || message.type !== 'start') return
    try {
      runHeavyMigration({
        sourceDb: message.sourceDb,
        sourceRoot: message.sourceRoot,
        target: message.target,
        onProgress: (phase, text, percent) =>
          port.postMessage({ type: 'progress', phase, message: text, percent })
      })
      port.postMessage({ type: 'done' })
    } catch (error) {
      port.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })
}
