import { homedir, platform } from 'node:os'
import { join } from 'node:path'

const APP_DIR_NAME = 'inkwell'

/**
 * 与 Electron 的 app.getPath('userData') 保持一致，
 * 让独立运行的 MCP Server 能打开与桌面应用同一个数据库。
 */
export function resolveUserDataDir(): string {
  if (platform() === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), APP_DIR_NAME)
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', APP_DIR_NAME)
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), APP_DIR_NAME)
}

/** 可用 INKWELL_DB 覆盖数据库路径（测试与多库场景） */
export function resolveDatabasePath(): string {
  return process.env.INKWELL_DB ?? join(resolveUserDataDir(), 'inkwell.db')
}