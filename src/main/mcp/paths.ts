import { existsSync, readFileSync } from 'node:fs'
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

/**
 * 读取 config.json 里活动书库的数据库路径。
 * M6 起书库可以放在任意磁盘，数据库不再固定在 userData；
 * 不读 config 的话，MCP Server 会打开（甚至新建）userData 下一个空库，
 * 外部 Agent 看到的就是一本空书。
 */
function resolveActiveLibraryDbPath(): string | null {
  try {
    const configPath = join(resolveUserDataDir(), 'config.json')
    if (!existsSync(configPath)) return null
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as {
      activeLibraryId?: string | null
      libraries?: Array<{ id?: string; path?: string }>
    }
    if (!raw.activeLibraryId || !Array.isArray(raw.libraries)) return null
    const entry = raw.libraries.find((item) => item?.id === raw.activeLibraryId)
    if (!entry?.path) return null
    const dbPath = join(entry.path, 'inkwell.db')
    return existsSync(dbPath) ? dbPath : null
  } catch {
    return null
  }
}

/**
 * 数据库路径优先级：
 *   1) INKWELL_DB 环境变量（测试 / 多库显式指定）
 *   2) config.json 里的活动书库
 *   3) userData/inkwell.db（旧版单库布局的兜底）
 */
export function resolveDatabasePath(): string {
  if (process.env.INKWELL_DB) return process.env.INKWELL_DB
  return resolveActiveLibraryDbPath() ?? join(resolveUserDataDir(), 'inkwell.db')
}