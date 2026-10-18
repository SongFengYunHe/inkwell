import { app } from 'electron'
import { IpcChannel, prefSetSchema } from '@shared/ipc'
import { closeDatabase, latestSchemaVersion } from './db/client'
import { listUiPrefs, removeUiPref, resetUiPrefs, setUiPref } from './db/ui-pref-repo'

/**
 * M13「UI 偏好持久化」端到端自检：electron . --smoke-m13
 *
 * 断言（共 6 项）：
 *   1. 书库 schema 已升到含 ui_pref 的 v11；
 *   2. ui_pref 往返 + upsert（同键覆盖生效、值更新且不重复）；
 *   3. removeUiPref 后键消失；
 *   4. resetUiPrefs() 后 listUiPrefs() 为空；
 *   5. zod 校验：prefSetSchema 拒绝空 key；
 *   6. 4 个 pref 通道常量齐备。
 *
 * 自检沿用全局独立 temp userData（index.ts 已为所有 smoke 设置），
 * 且开头 / 结尾都 resetUiPrefs()，不污染真实习惯画像。
 */
export async function runSmokeM13(): Promise<void> {
  const checks: Array<[string, boolean]> = []

  try {
    resetUiPrefs()

    /* ---------- 1. schema 已升到含 ui_pref 的 v11 ---------- */
    checks.push([
      `书库 schema 已升到 v${latestSchemaVersion()}（含 ui_pref）`,
      latestSchemaVersion() >= 11
    ])

    /* ---------- 2. 往返 + upsert ---------- */
    setUiPref('layout:default', '{"a":1}')
    const first = listUiPrefs()['layout:default']
    setUiPref('layout:default', '{"a":2}')
    const second = listUiPrefs()['layout:default']
    const dupCount = Object.keys(listUiPrefs()).filter((key) => key === 'layout:default').length
    checks.push([
      `ui_pref 往返与 upsert：首次 ${first} → 覆盖 ${second}`,
      first === '{"a":1}' && second === '{"a":2}' && dupCount === 1
    ])

    /* ---------- 3. remove ---------- */
    removeUiPref('layout:default')
    checks.push(['removeUiPref 后键消失', !('layout:default' in listUiPrefs())])

    /* ---------- 4. reset ---------- */
    setUiPref('cmd:usage', '{}')
    setUiPref('toolbar:pin', '[]')
    resetUiPrefs()
    checks.push(['resetUiPrefs() 后 listUiPrefs() 为空', Object.keys(listUiPrefs()).length === 0])

    /* ---------- 5. zod 校验：空 key 被拒 ---------- */
    checks.push([
      'prefSetSchema 拒绝空 key',
      prefSetSchema.safeParse({ key: '', value: 'x' }).success === false
    ])

    /* ---------- 6. 通道常量齐备 ---------- */
    checks.push([
      'pref 通道常量齐备',
      IpcChannel.prefAll === 'pref:all' &&
        IpcChannel.prefSet === 'pref:set' &&
        IpcChannel.prefRemove === 'pref:remove' &&
        IpcChannel.prefReset === 'pref:reset'
    ])
  } catch (error) {
    checks.push(['自检执行未抛错：' + (error instanceof Error ? error.message : String(error)), false])
  } finally {
    try {
      resetUiPrefs()
    } catch {
      // 清理失败不影响结论
    }
    try {
      closeDatabase()
    } catch {
      // 忽略
    }
  }

  const failed = checks.filter(([, ok]) => !ok)
  for (const [name, ok] of checks) console.log((ok ? '  ✓ ' : '  ✗ ') + name)
  console.log('---')
  console.log('通过 ' + (checks.length - failed.length) + '/' + checks.length + ' 项检查')
  if (failed.length > 0) {
    console.log('M13_SMOKE_FAILED')
    app.exit(1)
    return
  }
  console.log('M13_SMOKE_OK')
  app.exit(0)
}
