import { useEffect, useState } from 'react'
import type { AuditConfig } from '@shared/types'
import { Labeled } from './ui'

/**
 * M10：审计维度配置。
 * 关掉的维度不再出现在审计报告里；minSeverity 与 warn 口径决定「什么算不通过」。
 */
export default function AuditConfigPanel() {
  const [dimensions, setDimensions] = useState<string[]>([])
  const [config, setConfig] = useState<AuditConfig | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.inkwell.audit.dimensions().then(setDimensions)
    void window.inkwell.audit.config().then(setConfig)
  }, [])

  const save = async (patch: { disabledDimensions?: string[]; minSeverity?: AuditConfig['minSeverity']; countWarnAsFail?: boolean }): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      setConfig(await window.inkwell.audit.saveConfig(patch))
      setMessage('已保存：下次审计即生效')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const disabled = new Set(config?.disabledDimensions ?? [])
  const toggle = (dimension: string): void => {
    const next = new Set(disabled)
    if (next.has(dimension)) next.delete(dimension)
    else next.add(dimension)
    void save({ disabledDimensions: [...next] })
  }

  return (
    <div className='mx-auto max-w-3xl space-y-5'>
      <section className='rounded-xl border border-stone-200 bg-white p-5 shadow-sm'>
        <h2 className='text-sm font-medium text-stone-700'>审计维度</h2>
        <p className='mt-1 text-xs text-stone-400'>关掉的维度不会出现在单章审稿与全书体检里（默认全部开启）。</p>
        <div className='mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2'>
          {dimensions.map((dimension) => (
            <label key={dimension} className='flex items-center gap-2 text-xs text-stone-600'>
              <input
                type='checkbox'
                checked={!disabled.has(dimension)}
                disabled={busy}
                onChange={() => toggle(dimension)}
                className='accent-amber-500'
              />
              <span className='truncate'>{dimension}</span>
            </label>
          ))}
        </div>
        {dimensions.length === 0 && <p className='mt-3 text-xs text-stone-400'>加载维度列表…</p>}
      </section>

      <section className='rounded-xl border border-stone-200 bg-white p-5 shadow-sm'>
        <h2 className='text-sm font-medium text-stone-700'>判定口径</h2>
        <div className='mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <Labeled label='最低计入严重度' hint='低于此级别的问题不影响「通过」'>
            <select
              value={config?.minSeverity ?? 'warn'}
              disabled={busy}
              onChange={(e) => void save({ minSeverity: e.target.value as AuditConfig['minSeverity'] })}
              className='w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm'
            >
              <option value='info'>info（提示也算）</option>
              <option value='warn'>warn（警告及以上）</option>
              <option value='error'>error（只有严重才算）</option>
            </select>
          </Labeled>
          <div className='flex items-end'>
            <label className='flex items-center gap-2 text-xs text-stone-600'>
              <input
                type='checkbox'
                checked={config?.countWarnAsFail ?? false}
                disabled={busy}
                onChange={(e) => void save({ countWarnAsFail: e.target.checked })}
                className='accent-amber-500'
              />
              warn 级问题也算「不通过」
            </label>
          </div>
        </div>
        {message && <p className='mt-3 text-xs text-stone-500'>{message}</p>}
      </section>

      <p className='text-[11px] text-stone-400'>
        确定性维度（字数 / 标点 / 重复句 / AI 腔等）不花钱、不联网；语义维度（OOC / 设定 / 时间线 / 伏笔 / 称谓）需要审稿模型，仅在勾选「模型语义审计」时才会调用。
      </p>
    </div>
  )
}
