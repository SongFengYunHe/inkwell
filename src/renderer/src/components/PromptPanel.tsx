import { useEffect, useMemo, useState } from 'react'
import type { PromptTemplateInfo } from '@shared/types'
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT_CLASS } from './ui'

/**
 * A1 提示词模板（计划书 §12 的关键提示词资产）。
 * 左侧按类别列出全部模板，右侧可覆写「系统提示词」与「指令块」，
 * {{变量}} 会由程序在调用时替换；留空即恢复内置默认。
 */
export default function PromptPanel() {
  const [items, setItems] = useState<PromptTemplateInfo[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [system, setSystem] = useState('')
  const [instruction, setInstruction] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const active = useMemo(() => items.find((item) => item.key === activeKey) ?? null, [items, activeKey])

  const reload = async (key?: string): Promise<void> => {
    const list = await window.inkwell.prompt.list()
    setItems(list)
    const target = list.find((item) => item.key === (key ?? activeKey)) ?? list[0] ?? null
    if (target) {
      setActiveKey(target.key)
      setSystem(target.system)
      setInstruction(target.instruction)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const select = (item: PromptTemplateInfo): void => {
    setMessage('')
    setActiveKey(item.key)
    setSystem(item.system)
    setInstruction(item.instruction)
  }

  const save = async (): Promise<void> => {
    if (!active) return
    setBusy(true)
    setMessage('')
    try {
      const saved = await window.inkwell.prompt.save({ key: active.key, system, instruction })
      setMessage(saved.overridden ? '已保存覆写（下次生成即生效）' : '已清空覆写，恢复内置默认')
      await reload(active.key)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const reset = async (): Promise<void> => {
    if (!active) return
    setBusy(true)
    try {
      await window.inkwell.prompt.reset(active.key)
      setMessage('已恢复内置默认')
      await reload(active.key)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl gap-5">
      <aside className="w-72 shrink-0 space-y-1">
        <p className="px-1 pb-1 text-xs text-stone-400">共 {items.length} 条模板</p>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => select(item)}
            className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition ${
              item.key === activeKey ? 'bg-amber-50' : 'hover:bg-stone-50'
            }`}
          >
            <span className="flex items-center gap-2 text-xs text-stone-700">
              {item.title}
              {item.overridden && (
                <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-800">已改</span>
              )}
            </span>
            <span className="text-[10px] text-stone-400">{item.category} · {item.key}</span>
          </button>
        ))}
      </aside>

      <section className="min-w-0 flex-1 space-y-4">
        {active ? (
          <>
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <h2 className="text-sm font-medium text-stone-700">{active.title}</h2>
              <p className="mt-1 text-xs text-stone-500">{active.description}</p>
              <p className="mt-2 text-[11px] text-stone-400">
                可用变量：{active.variables.map((v) => '{{' + v + '}}').join('、') || '（无）'}
              </p>
            </div>

            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <h3 className="text-xs font-medium text-stone-600">系统提示词（角色设定）</h3>
              <textarea
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                rows={6}
                className={`mt-2 ${INPUT_CLASS} resize-y font-mono text-[12px] leading-5`}
              />
            </div>

            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <h3 className="text-xs font-medium text-stone-600">指令块（用户消息尾部）</h3>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={14}
                className={`mt-2 ${INPUT_CLASS} resize-y font-mono text-[12px] leading-5`}
              />
            </div>

            <div className="flex items-center gap-3">
              <button type="button" onClick={() => void save()} disabled={busy} className={BUTTON_PRIMARY}>
                保存覆写
              </button>
              <button type="button" onClick={() => void reset()} disabled={busy} className={BUTTON_GHOST}>
                恢复默认
              </button>
              {message && <span className="text-xs text-stone-500">{message}</span>}
            </div>
            <p className="text-[11px] text-stone-400">
              提示：MCP Server 是独立进程，覆写后需要重启 Agent 侧的 MCP 连接才会生效。
            </p>
          </>
        ) : (
          <p className="text-sm text-stone-400">加载中…</p>
        )}
      </section>
    </div>
  )
}
