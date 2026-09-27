import { join } from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { closeDatabase, initDatabase } from './db/client'
import { registerIpcHandlers } from './ipc'
import { runSmoke } from './smoke'
import { runSmokeLlm } from './smoke-llm'
import { runSmokeMcp } from './smoke-mcp'

const isSmokeRun = process.argv.includes('--smoke')
const isLlmSmokeRun = process.argv.includes('--smoke-llm')
const isMcpSmokeRun = process.argv.includes('--smoke-mcp')

// 冒烟自检使用独立目录，避免污染真实用户数据
if (isSmokeRun || isLlmSmokeRun || isMcpSmokeRun) {
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

app.whenReady().then(() => {
  const dbFile = join(app.getPath('userData'), 'inkwell.db')
  initDatabase(dbFile)
  console.log(`[inkwell] database ready: ${dbFile}`)

  if (isSmokeRun) {
    runSmoke()
    return
  }

  if (isLlmSmokeRun) {
    void runSmokeLlm()
    return
  }

  if (isMcpSmokeRun) {
    void runSmokeMcp()
    return
  }

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  closeDatabase()
})