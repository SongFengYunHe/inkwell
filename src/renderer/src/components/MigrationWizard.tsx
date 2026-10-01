import { useEffect, useState } from 'react'
import type { LibraryPrecheck, MigrationProgress, MigrationResult } from '@shared/types'
import { useAppStore } from '../stores/appStore'
import { BUTTON_GHOST, BUTTON_PRIMARY } from './ui'

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

type Step = 'intro' | 'choose' | 'precheck' | 'running' | 'result'

export default function MigrationWizard() {
  const closeMigration = useAppStore((s) => s.closeMigration)
  const loadBootstrap = useAppStore((s) => s.loadBootstrap)
  const loadProjects = useAppStore((s) => s.loadProjects)

  const [step, setStep] = useState<Step>('intro')
  const [target, setTarget] = useState('')
  const [precheck, setPrecheck] = useState<LibraryPrecheck | null>(null)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)
  const [result, setResult] = useState<MigrationResult | null>(null)
  const [error, setError] = useState('')

  // 迁移执行期间订阅进度推送
  useEffect(() => {
    return window.inkwell.onMigrationEvent((event) => {
      if (event.type === 'progress') setProgress(event.progress)
      else setResult(event.result)
    })
  }, [])

  const pickTarget = async (): Promise<void> => {
    setError('')
    try {
      const picked = await window.inkwell.app.pickFolder()
      if (picked) setTarget(picked)
    } catch (err) {
      // 选目录失败必须说出来：否则输入框仍是旧路径，用户以为选好了直接迁移到错目录
      setError(`选择目录失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const runPrecheck = async (): Promise<void> => {
    setError('')
    try {
      const report = await window.inkwell.library.precheck(target)
      setPrecheck(report)
      setStep('precheck')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const runMigration = async (): Promise<void> => {
    setError('')
    setStep('running')
    try {
      const outcome = await window.inkwell.library.migrate({ targetPath: target })
      setResult(outcome)
      if (outcome.ok) {
        await loadBootstrap()
        await loadProjects()
      }
      setStep('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('result')
    }
  }

  const giveUp = async (): Promise<void> => {
    await window.inkwell.library.dismissMigration()
    closeMigration()
  }

  const blocked = precheck?.blockingError ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-6">
      <div className="flex w-full max-w-lg flex-col gap-5 rounded-2xl bg-white p-6 shadow-xl">
        <header>
          <h2 className="text-base font-medium text-stone-800">把书库搬到你想放的位置</h2>
          <p className="mt-1 text-xs text-stone-500">
            第 {['一', '二', '三', '四', '五'][['intro', 'choose', 'precheck', 'running', 'result'].indexOf(step)]} 步 / 共 5 步
          </p>
        </header>

        {step === 'intro' && (
          <div className="flex flex-col gap-3 text-sm text-stone-600">
            <p>迁移后，你的书库（数据库、备份、导出、封面）可以放在任意磁盘，甚至 U 盘，便于随身携带与多库切换。</p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-stone-500">
              <li>迁移用的是 SQLite 官方快照（VACUUM INTO），不是直接复制文件；</li>
              <li>迁移完成前会逐表校验行数并做完整性检查，任一步失败都会自动回滚、指针不变；</li>
              <li>旧的 userData 数据不会立即删除，先保留，确认无误后再清理。</li>
            </ul>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              密钥与配置文件仍留在系统用户目录（%APPDATA%\inkwell）——它是指向书库的指针，且加密与当前系统用户绑定。
            </p>
          </div>
        )}

        {step === 'choose' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-stone-600">选择目标目录（建议放在非系统盘，如 D:\Inkwell书库）。</p>
            <div className="flex gap-2">
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="D:\Inkwell书库"
                className="flex-1 rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-amber-500"
              />
              <button type="button" onClick={() => void pickTarget()} className={BUTTON_GHOST}>
                浏览…
              </button>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        )}

        {step === 'precheck' && precheck && (
          <div className="flex flex-col gap-3 text-sm">
            <dl className="rounded-lg border border-stone-200 text-xs">
              <Row label="目标目录" value={precheck.path} />
              <Row label="可写" value={precheck.writable ? '是' : '否'} />
              <Row label="已有书库文件" value={precheck.hasDatabase ? '是（将按冲突处理）' : '否'} />
              <Row label="可用空间" value={formatBytes(precheck.freeBytes)} />
              <Row label="当前库大小" value={formatBytes(precheck.sourceBytes)} />
            </dl>
            {precheck.syncProvider && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                检测到同步盘「{precheck.syncProvider}」：SQLite 的 WAL 在网络同步盘上可能损坏，迁移后将自动降级为
                journal_mode=DELETE。
              </p>
            )}
            {precheck.networkPath && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                该路径看起来是网络盘（UNC）。可以继续，但建议改用本地磁盘。
              </p>
            )}
            {precheck.blockingError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{precheck.blockingError}</p>
            )}
          </div>
        )}

        {step === 'running' && (
          <div className="flex flex-col gap-3 text-sm text-stone-600">
            <p>{progress?.message ?? '正在准备迁移…'}</p>
            <div className="h-2 overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${progress && progress.percent >= 0 ? progress.percent : 5}%` }}
              />
            </div>
            <p className="text-xs text-stone-400">迁移过程中可以关闭窗口，中断不会损坏原书库。</p>
          </div>
        )}

        {step === 'result' && (
          <div className="flex flex-col gap-3 text-sm">
            {result?.ok ? (
              <>
                <p className="text-emerald-700">迁移完成，数据已校验通过，指针已切到新位置。</p>
                <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">
                  旧数据仍保留在原 userData 目录，确认一切正常后可在「书库」页清理。
                </p>
              </>
            ) : (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                迁移失败：{error || result?.error || '未知错误'}
                {result?.rolledBack ? '（目标半成品已清理，指针未改动）' : ''}
              </p>
            )}
          </div>
        )}

        <footer className="flex items-center justify-between gap-2 pt-1">
          {step === 'intro' && (
            <>
              <button type="button" onClick={() => void giveUp()} className={BUTTON_GHOST}>
                暂不迁移
              </button>
              <button type="button" onClick={() => setStep('choose')} className={BUTTON_PRIMARY}>
                开始
              </button>
            </>
          )}
          {step === 'choose' && (
            <>
              <button type="button" onClick={() => setStep('intro')} className={BUTTON_GHOST}>
                上一步
              </button>
              <button
                type="button"
                onClick={() => void runPrecheck()}
                disabled={!target.trim()}
                className={BUTTON_PRIMARY}
              >
                预检
              </button>
            </>
          )}
          {step === 'precheck' && (
            <>
              <button type="button" onClick={() => setStep('choose')} className={BUTTON_GHOST}>
                换个目录
              </button>
              <button
                type="button"
                onClick={() => void runMigration()}
                disabled={Boolean(blocked)}
                className={BUTTON_PRIMARY}
              >
                {precheck?.hasDatabase ? '确认迁移' : '开始迁移'}
              </button>
            </>
          )}
          {step === 'running' && <span className="text-xs text-stone-400">迁移进行中，请勿关闭应用…</span>}
          {step === 'result' && (
            <button type="button" onClick={closeMigration} className={`${BUTTON_PRIMARY} ml-auto`}>
              完成
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-3 py-1.5 last:border-0">
      <dt className="shrink-0 text-stone-400">{label}</dt>
      <dd className="break-all text-right text-stone-700">{value}</dd>
    </div>
  )
}