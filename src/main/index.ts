import { join } from 'node:path'
import { BrowserWindow, app, safeStorage, shell } from 'electron'
import { checkpointWal, closeDatabase, getDatabasePath, initDatabase, isDatabaseOpen, optimizeDatabase } from './db/client'
import { markStaleRunsInterrupted } from './db/pipeline-repo'
import { registerIpcHandlers } from './ipc'
import { setSecretCrypto } from './security/secrets'
import { bootstrapLibraries } from './library/registry'
import { initIndexQueue } from './search/index-queue'
import { autoBackupEnabled, createBackup } from './db/backup'
import { cleanupExpiredTrash } from './db/trash'
import { gracefulShutdown, isQuitting, registerInterval } from './lifecycle'
import { initAutoUpdate } from './update'

const isSmokeRun = process.argv.includes('--smoke')
const isLlmSmokeRun = process.argv.includes('--smoke-llm')
const isMcpSmokeRun = process.argv.includes('--smoke-mcp')
const isM3SmokeRun = process.argv.includes('--smoke-m3')
const isM4SmokeRun = process.argv.includes('--smoke-m4')
const isM5SmokeRun = process.argv.includes('--smoke-m5')
const isM6SmokeRun = process.argv.includes('--smoke-m6')
const isM7SmokeRun = process.argv.includes('--smoke-m7')
const isM8SmokeRun = process.argv.includes('--smoke-m8')
const isM9SmokeRun = process.argv.includes('--smoke-m9')
const isM10SmokeRun = process.argv.includes('--smoke-m10')
const isM11SmokeRun = process.argv.includes('--smoke-m11')
const isM12SmokeRun = process.argv.includes('--smoke-m12')
const isM13SmokeRun = process.argv.includes('--smoke-m13')
const isM14SmokeRun = process.argv.includes('--smoke-m14')

const isAnySmokeRun =
  isSmokeRun ||
  isLlmSmokeRun ||
  isMcpSmokeRun ||
  isM3SmokeRun ||
  isM4SmokeRun ||
  isM5SmokeRun ||
  isM6SmokeRun ||
  isM7SmokeRun ||
  isM8SmokeRun ||
  isM9SmokeRun ||
  isM10SmokeRun ||
  isM11SmokeRun ||
  isM12SmokeRun ||
  isM13SmokeRun ||
  isM14SmokeRun

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
  // 回收站到期清理 + 导入暂存清理：启动后 20s 跑一次，之后每天一次
  // M12-B：导入解析器改为首次使用时动态 import，启动路径不再把它拉进主 bundle
  setTimeout(async () => {
    if (isQuitting()) return
    try {
      const removed = cleanupExpiredTrash()
      if (removed > 0) console.log(`[inkwell] purged ${removed} expired trash item(s)`)
    } catch (error) {
      console.error('[inkwell] trash cleanup failed:', error)
    }
    // R5：导入暂存此前只在「导入动作」里清理，长期不用导入的用户会一直留着旧会话
    try {
      if (isDatabaseOpen()) {
        const { pruneImportSessions } = await import('./import/session')
        const pruned = pruneImportSessions()
        if (pruned > 0) console.log(`[inkwell] pruned ${pruned} expired import session(s)`)
      }
    } catch (error) {
      console.error('[inkwell] import session cleanup failed:', error)
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

  // M14-C：每 2 小时合并 WAL 并让 SQLite 按需重统计，
  // 避免长时间会话下 -wal 无限增长、查询计划脱离真实数据分布。
  registerInterval(() => {
    if (isQuitting() || !isDatabaseOpen()) return
    try {
      checkpointWal()
      optimizeDatabase()
    } catch (error) {
      console.error('[inkwell] wal checkpoint / optimize failed:', error)
    }
  }, 2 * 60 * 60 * 1000)

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

app.whenReady().then(async () => {
  // 注入系统级密钥加密（MCP 独立进程不注入，降级为明文标注）
  setSecretCrypto(safeStorage)

  if (isAnySmokeRun) {
    const dbFile = join(app.getPath('userData'), 'inkwell.db')
    initDatabase(dbFile)
    console.log(`[inkwell] database ready: ${dbFile}`)

    // M12-B：各套自检按需动态 import，避免把 smoke 及其依赖（导出/导入等）打进启动 bundle
    if (isSmokeRun) return (await import('./smoke')).runSmoke()
    if (isLlmSmokeRun) return void (await import('./smoke-llm')).runSmokeLlm()
    if (isMcpSmokeRun) return void (await import('./smoke-mcp')).runSmokeMcp()
    if (isM3SmokeRun) return void (await import('./smoke-m3')).runSmokeM3()
    if (isM4SmokeRun) return void (await import('./smoke-m4')).runSmokeM4()
    if (isM5SmokeRun) return void (await import('./smoke-m5')).runSmokeM5()
    if (isM6SmokeRun) return void (await import('./smoke-m6')).runSmokeM6()
    if (isM7SmokeRun) return void (await import('./smoke-m7')).runSmokeM7()
    if (isM8SmokeRun) return void (await import('./smoke-m8')).runSmokeM8()
    if (isM9SmokeRun) return void (await import('./smoke-m9')).runSmokeM9()
    if (isM10SmokeRun) return void (await import('./smoke-m10')).runSmokeM10()
    if (isM11SmokeRun) return void (await import('./smoke-m11')).runSmokeM11()
    if (isM12SmokeRun) return void (await import('./smoke-m12')).runSmokeM12()
    if (isM13SmokeRun) return void (await import('./smoke-m13')).runSmokeM13()
    if (isM14SmokeRun) return void (await import('./smoke-m14')).runSmokeM14()
    return
  }

  // ---------- 正常启动：书库引导 ----------
  // 书库引导必须「永不抛错」：即使一个库都打不开，也要把窗口开起来，
  // 让用户在「书库」页新建 / 重新定位，而不是看到一个打不开的应用。
  try {
    const bootstrap = bootstrapLibraries()
    console.log(`[inkwell] library ready: ${getDatabasePath() || '(none)'}`)
    if (bootstrap.needsAttention) {
      console.warn(`[inkwell] library attention: ${bootstrap.attentionMessage}`)
    }
  } catch (error) {
    console.error('[inkwell] library bootstrap failed:', error)
  }

  // 上次异常退出遗留的连写任务标记为中断，供用户从断点继续（无库时跳过）
  if (isDatabaseOpen()) {
    try {
      const stale = markStaleRunsInterrupted()
      if (stale > 0) console.log(`[inkwell] marked ${stale} stale pipeline run(s) as interrupted`)
    } catch (error) {
      console.error('[inkwell] marking stale runs failed:', error)
    }
  }

  scheduleMaintenance()
  // M12-C：启动后延迟排空向量索引队列（空闲时执行，可暂停）
  if (isDatabaseOpen()) initIndexQueue()
  registerIpcHandlers()
  createWindow()
  // A4：挂上自动更新（仅打包版生效；开发模式直接标记 unsupported）
  initAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 自检运行期间不要因为「临时窗口（例如 PDF 导出用的隐藏窗口）被销毁」而退出：
  // 自检自己用 app.exit(0/1) 收尾，这里一旦 app.quit 就会把数据库关掉，
  // 后续清理逻辑会以「数据库尚未初始化」失败。
  if (isAnySmokeRun) return
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