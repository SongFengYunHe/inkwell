/**
 * 打包前清空产物目录（唯一 output 目录 = release/）。
 *
 * 为什么单独写一个脚本，而不是在 package.json 里写 rm -rf：
 *   - Windows 上目录被占用时 npm 的失败信息毫无指向性，而 electron-builder
 *     在 fs.rm(appOutDir) 失败后会把 win-unpacked **掏空**并留下 300MB+ 的
 *     win-unpacked.tmp（历史上真实发生过两次）；
 *   - 这里「先整目录改名、再删改名后的目录」：
 *       · 改名是原子的，只要有任何文件被占用就会直接失败 —— 此时**一个文件都不删**；
 *       · 改名成功后 release/ 立刻就是干净的，删不掉也只是留下一个 parked 目录。
 *
 * 同时清理历史遗留的 release_build/（早期用 --config.directories.output 绕锁产生的第二目录）。
 */
import { closeSync, existsSync, openSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const TARGETS = ['release', 'release_build']

/** 递归列出目录下的所有文件 */
function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

/** 找出无法以读写方式打开的文件，用于给出可执行的提示 */
function findLocked(dir) {
  const locked = []
  for (const file of walk(dir)) {
    try {
      const fd = openSync(file, 'r+')
      closeSync(fd)
    } catch {
      locked.push(file)
    }
  }
  return locked
}

function dirSize(dir) {
  let total = 0
  for (const file of walk(dir)) {
    try {
      total += statSync(file).size
    } catch {
      // 统计失败不影响清理
    }
  }
  return total
}

let failed = false

for (const name of TARGETS) {
  const target = join(root, name)
  if (!existsSync(target)) continue

  const before = dirSize(target)
  const parked = join(root, name + '.removing-' + Date.now())

  try {
    // 原子改名：只要目录里有文件被占用，这一步就会失败，而目录内容分毫未动
    renameSync(target, parked)
  } catch (error) {
    failed = true
    console.error(
      '[clean] 无法清空 ' + name + '/：' + (error instanceof Error ? error.message : String(error))
    )
    const locked = findLocked(target)
    if (locked.length > 0) {
      console.error('[clean] 以下文件被占用（未删除任何文件）：')
      for (const file of locked.slice(0, 10)) console.error('  - ' + file)
      if (locked.length > 10) console.error('  … 其余 ' + (locked.length - 10) + ' 个')
    }
    console.error('[clean] 处理办法：')
    console.error('  1) 关闭正在运行的 Inkwell / 自检进程；不要就地运行 release/win-unpacked/Inkwell.exe，')
    console.error('     跑安装版自检请先把整个 win-unpacked 复制到 %TEMP% 再运行；')
    console.error('  2) 用「资源监视器 → CPU → 关联的句柄」搜索上面的文件名，结束持有进程；')
    console.error('  3) 找不到持有者时重启系统，然后重跑 npm run dist:win。')
    continue
  }

  try {
    rmSync(parked, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    console.log('[clean] 已清空 ' + name + '/（释放 ' + (before / 1024 / 1024).toFixed(1) + ' MB）')
  } catch (error) {
    // 目录已经挪走，release/ 是干净的，可以继续打包；剩下的残渣稍后手动删
    console.warn(
      '[clean] ' + name + '/ 已挪到 ' + parked + '，但未能删除：' +
        (error instanceof Error ? error.message : String(error))
    )
    console.warn('[clean] ' + name + '/ 现在已经是干净的，可以继续打包；请稍后手动删除上面这个目录。')
  }
}

if (failed) process.exit(1)
