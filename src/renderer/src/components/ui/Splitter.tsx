import { useRef } from 'react'
import { cn } from './cn'

/**
 * 统一可拖拽分隔条（M13-B）：Dock 面板调宽用。
 * 只上报「增量」，由调用方决定钳制范围，避免组件里出现布局魔法值。
 */
export function Splitter({
  onDrag,
  side = 'left',
  label = '调整宽度',
  className
}: {
  onDrag: (deltaX: number) => void
  /** 拖拽方向：面板在分隔条左侧还是右侧（决定光标与热区） */
  side?: 'left' | 'right'
  label?: string
  className?: string
}) {
  const last = useRef(0)

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(event) => {
        last.current = event.clientX
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const delta = event.clientX - last.current
        last.current = event.clientX
        onDrag(delta)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onKeyDown={(event) => {
        // 键盘可达：方向键以 16px 步进调整（+ 向右为正，由调用方按面板所在侧决定方向）
        if (event.key === 'ArrowLeft') onDrag(-16)
        else if (event.key === 'ArrowRight') onDrag(16)
      }}
      className={cn(
        'group relative w-1 shrink-0 cursor-col-resize bg-transparent',
        'focus-visible:ring-2 focus-visible:ring-ink-primary/60 focus-visible:outline-none',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'transition-ink absolute inset-y-0 w-2 group-hover:bg-amber-400/40',
          side === 'left' ? '-left-0.5' : '-right-0.5'
        )}
      />
    </div>
  )
}
