import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { closeDatabase, initDatabase } from '../db/client'
import { createInkwellMcpServer } from './server'
import { resolveDatabasePath } from './paths'

/**
 * Inkwell MCP Server（stdio 入口）。
 * 由外部 Agent（TRAE WorkBuddy / Claude Code / Cursor 等）拉起，用其自身额度完成模型调用，
 * Inkwell 只负责上下文装配、状态推进与落盘。
 *
 * 运行：
 *   开发：  node out/main/mcp.js            （可用环境变量 INKWELL_DB 覆盖数据库路径）
 *   安装版：Inkwell.exe（配 ELECTRON_RUN_AS_NODE=1）+ resources/app.asar/out/main/mcp.js
 *
 * 注意：stdout 属于 MCP 协议，所有日志一律走 stderr。
 */
async function main(): Promise<void> {
  const dbPath = resolveDatabasePath()
  initDatabase(dbPath)
  console.error(`[inkwell-mcp] database: ${dbPath}`)

  const server = createInkwellMcpServer()
  await server.connect(new StdioServerTransport())
  console.error('[inkwell-mcp] ready on stdio')

  const shutdown = (): void => {
    closeDatabase()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error: unknown) => {
  console.error('[inkwell-mcp] fatal:', error)
  process.exit(1)
})