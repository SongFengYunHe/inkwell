import { BrowserWindow, app } from 'electron'
import type { UpdateStatus } from '@shared/types'
import { IpcChannel } from '@shared/ipc'
import { getSettings } from './library/registry'
import { registerInterval } from './lifecycle'

/**
 * A4 自动更新（electron-updater + GitHub Releases）。
 *
 * 行为边界：
 *   - 只有打包安装后的版本才检查（开发模式直接返回 unsupported）；
 *   - 只自动「检查 + 提示」，下载与安装都由用户在设置页点按钮触发（不自作主张重启应用）；
 *   - 更新源来自 electron-builder.yml 的 publish（GitHub Releases 的 latest.yml）。
 *
 * M12-B：electron-updater 改为「首次真正需要时」动态 import（开发模式 / 未打包时永不加载），
 *        以减轻冷启动时的 require 开销。
 */

type AutoUpdater = typeof import('electron-updater').autoUpdater

let updater: AutoUpdater | null = null
let updaterPromise: Promise<AutoUpdater> | null = null

/** 惰性加载 electron-updater；失败向上抛，由调用方按「不可用」处理 */
function loadUpdater(): Promise<AutoUpdater> {
  if (updater) return Promise.resolve(updater)
  updaterPromise ??= import('electron-updater').then((module) => {
    updater = module.autoUpdater
    return updater
  })
  return updaterPromise
}

const listeners = new Set<(status: UpdateStatus) => void>()

let status: UpdateStatus = {
  // 未打包时直接声明「不支持」，避免 UI 上出现一个永远不会成功的「检查更新」
  phase: app.isPackaged ? 'idle' : 'unsupported',
  currentVersion: app.getVersion(),
  version: null,
  releaseNotes: '',
  percent: 0,
  bytesPerSecond: 0,
  message: app.isPackaged ? '' : '开发模式不检查更新（打包安装后可用）',
  supported: app.isPackaged
}

function normalizeNotes(notes: unknown): string {
  if (typeof notes === 'string') return notes.slice(0, 4000)
  if (Array.isArray(notes)) {
    return notes
      .map((item) => (item && typeof item === 'object' && 'note' in item ? String((item as { note?: string }).note ?? '') : ''))
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000)
  }
  return ''
}

function emit(patch: Partial<UpdateStatus>): UpdateStatus {
  status = { ...status, ...patch, currentVersion: app.getVersion(), supported: app.isPackaged }
  for (const listener of listeners) {
    try {
      listener(status)
    } catch {
      // 单个订阅者异常不影响其它
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(IpcChannel.updateEvent, status)
    } catch {
      // 窗口已销毁时忽略
    }
  }
  return status
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function subscribeUpdateStatus(listener: (value: UpdateStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let initialized = false

/** 启动时挂事件与定时检查（重复调用安全） */
export function initAutoUpdate(): void {
  if (initialized) return
  initialized = true

  if (!app.isPackaged) {
    emit({ phase: 'unsupported', message: '开发模式不检查更新（打包安装后可用）' })
    return
  }

  void (async () => {
    try {
      const autoUpdater = await loadUpdater()
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true

      autoUpdater.on('checking-for-update', () => emit({ phase: 'checking', message: '正在检查更新…' }))
      autoUpdater.on('update-available', (info) =>
        emit({
          phase: 'available',
          version: info.version,
          releaseNotes: normalizeNotes((info as { releaseNotes?: unknown }).releaseNotes),
          message: '发现新版本 ' + info.version
        })
      )
      autoUpdater.on('update-not-available', (info) =>
        emit({ phase: 'not-available', version: info.version, message: '已是最新版本' })
      )
      autoUpdater.on('download-progress', (progress) =>
        emit({
          phase: 'downloading',
          percent: Math.round(progress.percent * 10) / 10,
          bytesPerSecond: Math.round(progress.bytesPerSecond),
          message: '正在下载新版本…'
        })
      )
      autoUpdater.on('update-downloaded', (info) =>
        emit({ phase: 'downloaded', version: info.version, percent: 100, message: '新版本已下载，重启即可安装' })
      )
      autoUpdater.on('error', (error) =>
        emit({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
      )
    } catch (error) {
      // electron-updater 加载 / 初始化失败（例如缺少 app-update.yml）不应影响应用启动
      emit({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
      return
    }

    registerInterval(() => {
      if (!getSettings().autoUpdate) return
      void checkForUpdates().catch(() => undefined)
    }, 6 * 60 * 60 * 1000)

    setTimeout(() => {
      if (!getSettings().autoUpdate) return
      void checkForUpdates().catch(() => undefined)
    }, 30_000).unref?.()
  })()
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return emit({ phase: 'unsupported', message: '开发模式不检查更新（打包安装后可用）' })
  }
  emit({ phase: 'checking', message: '正在检查更新…' })
  try {
    const autoUpdater = await loadUpdater()
    await autoUpdater.checkForUpdates()
  } catch (error) {
    emit({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
  }
  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return emit({ phase: 'unsupported', message: '开发模式不支持下载更新' })
  }
  if (status.phase !== 'available' && status.phase !== 'error') {
    return emit({ phase: status.phase, message: '当前没有可下载的新版本' })
  }
  emit({ phase: 'downloading', percent: 0, message: '正在下载新版本…' })
  try {
    const autoUpdater = await loadUpdater()
    await autoUpdater.downloadUpdate()
  } catch (error) {
    emit({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
  }
  return status
}

/** 退出并安装（由用户在设置页显式触发） */
export function installUpdate(): void {
  if (status.phase !== 'downloaded') return
  setImmediate(() => {
    void loadUpdater()
      .then((autoUpdater) => autoUpdater.quitAndInstall())
      .catch((error: unknown) => emit({ phase: 'error', message: error instanceof Error ? error.message : String(error) }))
  })
}
