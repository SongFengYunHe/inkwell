import { useRef, type ReactNode } from 'react'
import { cn } from './cn'

export interface TabItem<K extends string = string> {
  key: K
  label: string
  badge?: ReactNode
  disabled?: boolean
}

/**
 * 统一 Tab（M13-A/C）：方向键在标签内移动、Home/End 跳首尾（键盘闭环），
 * role=tab + aria-selected，供所有「页内分栏」复用，避免各页自画 tab 条。
 */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  className,
  ariaLabel,
  reorderable = false,
  onReorder
}: {
  items: Array<TabItem<K>>
  value: K
  onChange: (key: K) => void
  className?: string
  ariaLabel?: string
  /** M13-B：允许拖拽重排（主区 Tab 顺序即用户工作顺序） */
  reorderable?: boolean
  onReorder?: (from: number, to: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const dragFrom = useRef<number | null>(null)

  const focusTab = (index: number): void => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])')
    buttons?.[index]?.focus()
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex gap-1 border-b border-ink-border bg-ink-surface px-4', className)}
    >
      {items.map((item, index) => {
        const selected = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            draggable={reorderable && !item.disabled}
            onDragStart={() => {
              dragFrom.current = index
            }}
            onDragOver={(event) => {
              if (reorderable) event.preventDefault()
            }}
            onDrop={() => {
              const from = dragFrom.current
              dragFrom.current = null
              if (from === null || from === index) return
              onReorder?.(from, index)
            }}
            onDragEnd={() => {
              dragFrom.current = null
            }}
            onClick={() => onChange(item.key)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault()
                focusTab((index + 1) % items.length)
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault()
                focusTab((index - 1 + items.length) % items.length)
              } else if (event.key === 'Home') {
                event.preventDefault()
                focusTab(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                focusTab(items.length - 1)
              } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onChange(item.key)
              }
            }}
            className={cn(
              'transition-ink -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm',
              'focus-visible:ring-2 focus-visible:ring-ink-primary/60 focus-visible:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-40',
              selected
                ? 'border-amber-500 font-medium text-ink-text'
                : 'border-transparent text-ink-muted hover:text-ink-text'
            )}
          >
            {item.label}
            {item.badge}
          </button>
        )
      })}
    </div>
  )
}
