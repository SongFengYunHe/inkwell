#!/usr/bin/env node
/**
 * M14-B/D：打包层真实运行探针（npm run verify:pack）
 *
 * 为什么需要：CI 此前只 typecheck + 打包 + 量体积，**从不运行打包后的应用**。
 * 历史上的真实教训：为瘦身裁剪 drizzle-orm 方言目录后，`sql/sql.js` 找不到
 * `pg-core/columns/enum.js`，应用启动即崩 —— 而 CI 全绿、体积也正常。
 * 这类「只在打包层才暴露」的回归，只有真的把包跑起来才抓得到（见记忆 §5）。
 *
 * 三段：
 *   1. 产物结构断言：release/win-unpacked / Inkwell.exe / resources/app.asar 齐备；
 *   2. asar 白名单断言：运行时必需的入口与依赖链文件确实在包内（含已知易被裁剪的
 *      drizzle-orm/pg-core/columns/enum.js），且原生模块已解到 app.asar.unpacked；
 *   3. 真实运行：把 win-unpacked 复制到 %TEMP%（**不就地运行** —— 就地跑会让下一次
 *      dist:win 的 clean:release 在删旧目录时 EBUSY），依次跑 `--smoke`（两遍，第二遍
 *      断言 PERSISTENCE_OK，验证打包版跨进程持久化）与 `--smoke-m14`
 *      （断言走真实的 better-sqlite3 原生模块 + drizzle 查询 + 迁移）。
 *
 * 用法：npm run dist:win && npm run verify:pack（或 npm run pack:dir 后直接跑）
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)

const ROOT = resolve(process.cwd())
const UNPACKED_DIR = join(ROOT, 'release', 'win-unpacked')
const RESOURCES_DIR = join(UNPACKED_DIR, 'resources')
const ASAR = join(RESOURCES_DIR, 'app.asar')
const ASAR_UNPACKED = join(RESOURCES_DIR, 'app.asar.unpacked')
const EXE = join(UNPACKED_DIR, 'Inkwell.exe')

/** 运行时必需的 asar 内文件（少一个就可能在真实启动时崩，而不只是某个功能不可用） */
const WHITELIST = [
  '/out/main/index.js',
  '/out/main/mcp.js',
  '/out/preload/index.js',
  '/out/renderer/index.html',
  '/node_modules/drizzle-orm/sql/sql.js',
  // 已知最易被「瘦身」误伤的依赖：sql/sql.js 会 require 它，缺了直接起不来
  '/node_modules/drizzle-orm/pg-core/columns/enum.js',
  '/node_modules/drizzle-orm/better-sqlite3/index.cjs',
  '/node_modules/better-sqlite3/lib/index.js'
]

/** 原生模块必须解包（asar 里的 .node 无法被 dlopen） */
const NATIVE_UNPACKED = join(ASAR_UNPACKED, 'node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node')

/** 打包版的真实运行探针：[参数, 断言输出中必须出现的关键字] */
const RUN_PROBES = [
  ['--smoke', null], // 第一遍：新库会走 FIRST_RUN_OK，旧库会走 PERSISTENCE_OK，只断言「没有 FAILED」
  ['--smoke', 'PERSISTENCE_OK'], // 第二遍：数据必须跨进程读回
  ['--smoke-m14', 'M14_SMOKE_OK']
]

const results = []
function check(name, ok) {
  results.push([name, ok])
  console.log((ok ? '  ✓ ' : '  ✗ ') + name)
}

/* ---------------- 1. 产物结构 ---------------- */
check('存在 release/win-unpacked/Inkwell.exe', existsSync(EXE))
check('存在 resources/app.asar', existsSync(ASAR))

/* ---------------- 2. asar 白名单 ---------------- */
let files = []
let listed = false
try {
  files = require('@electron/asar').listPackage(ASAR).map((f) => f.replace(/\\/g, '/'))
  listed = true
} catch (error) {
  console.error('[verify:pack] 读取 asar 失败：' + (error instanceof Error ? error.message : String(error)))
}

if (listed) {
  for (const entry of WHITELIST) check(`asar 内含 ${entry}`, files.includes(entry))
  check(
    'asar 内含主进程分包（out/main/chunks）',
    files.some((f) => f.startsWith('/out/main/chunks/'))
  )
  check(
    'asar 未夹带 source map / TypeScript 源码',
    !files.some((f) => f.endsWith('.map') || f.endsWith('.ts'))
  )
}
check('原生模块已解包（better-sqlite3/prebuilds/win32-x64.node）', existsSync(NATIVE_UNPACKED))

/* ---------------- 3. 真实运行打包版 ---------------- */
if (existsSync(EXE)) {
  const runDir = join(mkdtempSync(join(tmpdir(), 'inkwell-verify-pack-')), 'win-unpacked')
  try {
    // 复制再运行：release/ 里的文件一个都不被占用，下一次 dist:win 才能干净清目录
    cpSync(UNPACKED_DIR, runDir, { recursive: true })
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE // 残留该变量会让 electron 以纯 Node 模式启动（app undefined）

    for (const [flag, marker] of RUN_PROBES) {
      const result = spawnSync(join(runDir, 'Inkwell.exe'), [flag], {
        cwd: runDir,
        encoding: 'utf8',
        timeout: 120_000,
        env
      })
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
      const failed = /_FAILED|result: .*FAILED/.test(output)
      const label = `${flag}${marker ? ` → ${marker}` : ''}`
      if (marker) check(`打包版 ${label}`, !failed && output.includes(marker))
      else check(`打包版 ${flag} 未报告失败`, result.status === 0 && !failed)
      if ((marker && !output.includes(marker)) || failed) {
        console.error('---- ' + label + ' 输出 ----')
        console.error(output.trim() || '(无输出)')
      }
    }
  } finally {
    // 清理是尽力而为：Windows 上刚退出的 Electron 进程可能仍短暂持有 app.asar 句柄，
    // 删除会报 EPERM。此时**所有断言其实都已跑完**，绝不能因此把探针判负（假失败）。
    try {
      rmSync(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    } catch (error) {
      console.warn(
        '[verify:pack] 临时目录清理失败（不影响探针结论）：' +
          (error instanceof Error ? error.message : String(error))
      )
    }
  }
}

/* ---------------- 汇总 ---------------- */
const failed = results.filter(([, ok]) => !ok)
console.log('---')
console.log(`通过 ${results.length - failed.length}/${results.length} 项检查`)
if (failed.length > 0) {
  console.log('VERIFY_PACK_FAILED')
  process.exit(1)
}
console.log('VERIFY_PACK_OK')
