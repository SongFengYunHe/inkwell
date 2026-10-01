import { join } from 'node:path'
import { BrowserWindow, app, safeStorage, shell } from 'electron'
import { closeDatabase, getDatabasePath, initDatabase } from './db/client'
import { markStaleRunsInterrupted } from './db/pipeline-repo'
import { registerIpcHandlers } from './ipc'
import { setSecretCrypto } from './security/secrets'
import { runSmoke } from './smoke'
import { runSmokeLlm } from './smoke-llm'
import { runSmokeMcp } from './smoke-mcp'
import { runSmokeM3 } from './smoke-m3'
import { runSmokeM4 } from './smoke-m4'
import { runSmokeM5 } from './smoke-m5'
import { runSmokeM6 } from './smoke-m6'
import { runSmokeM7 } from './smoke-m7'
import { runSmokeM8 } from './smoke-m8'
import { bootstrapLibraries } from './library/registry'
import { autoBackupEnabled, createBackup } from './db/backup'
import { cleanupExpiredTrash } from './db/trash'
import { gracefulShutdown, isQuitting, registerInterval } from './lifecycle'

const isSmokeRun = process.argv.includes('--smoke')
const isLlmSmokeRun = process.argv.includes('--smoke-llm')
const isMcpSmokeRun = process.argv.includes('--smoke-mcp')
const isM3SmokeRun = process.argv.includes('--smoke-m3')
const isM4SmokeRun = process.argv.includes('--smoke-m4')
const isM5SmokeRun = process.argv.includes('--smoke-m5')
const isM6SmokeRun = process.argv.includes('--smoke-m6')
const isM7SmokeRun = process.argv.includes('--smoke-m7')
const isM8SmokeRun = process.argv.includes('--smoke-m8')

const isAnySmokeRun =
  isSmokeRun ||
  isLlmSmokeRun ||
  isMcpSmokeRun ||
  isM3SmokeRun ||
  isM4SmokeRun ||
  isM5SmokeRun ||
  isM6SmokeRun ||
  isM7SmokeRun ||
  isM8SmokeRun

// 冒烟自检使用独立目录，且不做书库引导（沿用固定库路径）
if (isAnySmokeRun) {
  app.setPath('userData', join(app.getPath('temp'), 'inkwell-smoke'))
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f7f6f3',
    title: 'Inkwell',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  // 外链交给系统浏览器，避免在应用内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 启动后的后台维护：自动备份轮转 + 回收站到期清理 */
function scheduleMaintenance(): void {
  // 回收站到期清理：启动后 20s 跑一次，之后每天一次
  setTimeout(() => {
    if (isQuitting()) return
    try {
      const removed = cleanupExpiredTrash()
      if (removed > 0) console.log(`[inkwell] purged ${removed} expired trash item(s)`)
    } catch (error) {
      console.error('[inkwell] trash cleanup failed:', error)
    }
  }, 20_000).unref?.()

  registerInterval(() => {
    if (!autoBackupEnabled()) return
    try {
      createBackup('interval')
    } catch (error) {
      console.error('[inkwell] scheduled backup failed:', error)
    }
  }, 6 * 60 * 60 * 1000)

  // 启动后 60s 做首次自动备份
  setTimeout(() => {
    if (isQuitting() || !autoBackupEnabled()) return
    try {
      createBackup('startup')
    } catch (error) {
      console.error('[inkwell] startup backup failed:', error)
    }
  }, 60_000).unref?.()
}

app.whenReady().then(() => {
  // 注入系统级密钥加密（MCP 独立进程不注入，降级为明文标注）
  setSecretCrypto(safeStorage)

  if (isAnySmokeRun) {
    const dbFile = join(app.getPath('userData'), 'inkwell.db')
    initDatabase(dbFile)
    console.log(`[inkwell] database ready: ${dbFile}`)

    if (isSmokeRun) return runSmoke()
    if (isLlmSmokeRun) return void runSmokeLlm()
    if (isMcpSmokeRun) return void runSmokeMcp()
    if (isM3SmokeRun) return void runSmokeM3()
    if (isM4SmokeRun) return void runSmokeM4()
    if (isM5SmokeRun) return void runSmokeM5()
    if (isM6SmokeRun) return void runSmokeM6()
    if (isM7SmokeRun) return void runSmokeM7()
    if (isM8SmokeRun) return void runSmokeM8()
    return
  }

  // ---------- 正常启动：书库引导 ----------
  const bootstrap = bootstrapLibraries()
  console.log(`[inkwell] library ready: ${getDatabasePath() || '(none)'}`)
  if (bootstrap.needsAttention) console.warn(`[inkwell] library attention: ${bootstrap.attentionMessage}`)

  // 上次异常退出遗留的连写任务标记为中断，供用户从断点继续
  const stale = markStaleRunsInterrupted()
  if (stale > 0) console.log(`[inkwell] marked ${stale} stale pipeline run(s) as interrupted`)

  scheduleMaintenance()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 优雅退出：先回收资源（中断在途请求 / 清定时器 / checkpoint 关库），再真正退出
let quitPrepared = false
app.on('before-quit', (event) => {
  if (quitPrepared) return
  event.preventDefault()
  quitPrepared = true
  void gracefulShutdown()
    .catch((error: unknown) => console.error('[inkwell] shutdown failed:', error))
    .finally(() => {
      try {
        app.releaseSingleInstanceLock()
      } catch {
        // 未获取过单实例锁时调用是安全的空操作
      }
      app.exit(0)
    })
})

app.on('will-quit', () => {
  // 兜底：正常路径已在 before-quit 里 closeDatabase（幂等）
  closeDatabase()
})