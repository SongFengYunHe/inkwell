#!/usr/bin/env node
/**
 * M14-C：统一 smoke runner —— 一条命令跑完全部自检套件。
 *
 * 为什么需要：历史上靠人工敲 foreach 逐套跑，漏跑很常见（计划书 §3.4）。
 * 关键优化：`electron-vite build` **只跑一次**，随后串行执行各 `--smoke-*`，
 * 避免每套各自构建（14 套原本要重复构建 14 次）。
 *
 * 用法：npm run smoke:all（或 node scripts/smoke-all.mjs）
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/** [展示名, 传给 electron 的参数] */
const SUITES = [
  ['smoke', '--smoke'],
  ['smoke:llm', '--smoke-llm'],
  ['smoke:mcp', '--smoke-mcp'],
  ['smoke:m3', '--smoke-m3'],
  ['smoke:m4', '--smoke-m4'],
  ['smoke:m5', '--smoke-m5'],
  ['smoke:m6', '--smoke-m6'],
  ['smoke:m7', '--smoke-m7'],
  ['smoke:m8', '--smoke-m8'],
  ['smoke:m9', '--smoke-m9'],
  ['smoke:m10', '--smoke-m10'],
  ['smoke:m11', '--smoke-m11'],
  ['smoke:m12', '--smoke-m12'],
  ['smoke:m13', '--smoke-m13'],
  ['smoke:m14', '--smoke-m14']
]

const isWin = process.platform === 'win32'
const bin = (name) => join(ROOT, 'node_modules', '.bin', isWin ? `${name}.cmd` : name)

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: isWin })
  return result.status === 0
}

// 已知坑：若 shell 里残留 ELECTRON_RUN_AS_NODE=1，electron 会以纯 Node 模式启动（app 为 undefined）
delete process.env.ELECTRON_RUN_AS_NODE

if (!existsSync(bin('electron'))) {
  console.error('[smoke:all] 未找到 electron，请先 npm install')
  process.exit(1)
}

console.log('[smoke:all] 构建一次（electron-vite build）…')
if (!run(bin('electron-vite'), ['build'])) {
  console.error('[smoke:all] 构建失败，终止')
  process.exit(1)
}

const failed = []
for (const [name, flag] of SUITES) {
  console.log(`\n[smoke:all] ▶ ${name}`)
  if (!run(bin('electron'), ['.', flag])) failed.push(name)
}

console.log('\n[smoke:all] ———— 汇总 ————')
if (failed.length === 0) {
  console.log(`[smoke:all] 全部 ${SUITES.length} 套自检通过`)
  process.exit(0)
}
console.log(`[smoke:all] 失败 ${failed.length}/${SUITES.length}：${failed.join(', ')}`)
process.exit(1)
