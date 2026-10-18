import { Modal } from './ui'
import { SHORTCUTS } from '../shortcuts'

/**
 * M13-C 快捷键速查浮层（`?` 或 `Ctrl+/` 唤起）。
 * 内容直接读 shortcuts.ts 的单一事实来源，新增快捷键只需要改一处。
 */
export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const groups = ['全局', '工作区'] as const

  return (
    <Modal title="快捷键速查" description="修饰键分区：Ctrl 全局 · Ctrl+Shift 面板 / 布局 · Alt 局部" size="md" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <section key={group}>
            <h3 className="mb-2 text-xs font-medium text-ink-muted">{group}</h3>
            <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {SHORTCUTS.filter((item) => item.group === group).map((item) => (
                <div key={item.id} className="flex items-center gap-2 text-xs">
                  <dt className="shrink-0">
                    <kbd className="rounded border border-ink-border bg-ink-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-text">
                      {item.keys}
                    </kbd>
                  </dt>
                  <dd className="min-w-0 flex-1 truncate text-ink-muted">{item.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="text-[11px] text-ink-subtle">
          输入框内不触发单键快捷键（`?`）；`Esc` 统一关闭当前弹层。
        </p>
      </div>
    </Modal>
  )
}
