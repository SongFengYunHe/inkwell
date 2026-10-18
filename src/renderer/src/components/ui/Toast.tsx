import { useEffect } from 'react'
import { create } from 'zustand'
import { cn } from './cn'

export type ToastTone = 'success' | 'error' | 'warning' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void | Promise<void>
}

export interface ToastItem {
  id: string
  message: string
  tone: ToastTone
  action?: ToastAction
  /** ms；0 表示不自动消失（错误默认粘滞） */
  duration: number
}

interface ToastState {
  items: ToastItem[]
  push: (item: Omit<ToastItem, 'id'>) => string
  dismiss: (id: string) => void
}

let seq = 0

const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (item) => {
    const id = `toast-${(seq += 1)}`
    set({ items: [...get().items, { ...item, id }] })
    return id
  },
  dismiss: (id) => set({ items: get().items.filter((item) => item.id !== id) })
}))

/**
 * 统一提示（M13-A）：成功 / 失败 / 警告 / 信息 四类，一处实现。
 * 失败默认粘滞不自动消失，杜绝「失败一闪而过、用户以为成功了」。
 */
export const toast = {
  success(message: string, action?: ToastAction): string {
    return useToastStore.getState().push({ message, tone: 'success', action, duration: 4000 })
  },
  error(message: string): string {
    return useToastStore.getState().push({ message, tone: 'error', duration: 0 })
  },
  warning(message: string): string {
    return useToastStore.getState().push({ message, tone: 'warning', duration: 5000 })
  },
  info(message: string, action?: ToastAction): string {
    return useToastStore.getState().push({ message, tone: 'info', action, duration: action ? 6000 : 4000 })
  },
  /** 带操作按钮的提示（如「已移入回收站 / 撤销」） */
  action(message: string, action: ToastAction, duration = 6000): string {
    return useToastStore.getState().push({ message, tone: 'info', action, duration })
  },
  dismiss(id: string): void {
    useToastStore.getState().dismiss(id)
  },
  dismissAll(): void {
    useToastStore.setState({ items: [] })
  }
}

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-red-200 bg-red-50 text-red-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-ink-border-strong bg-stone-900 text-white'
}

const DOT_CLASS: Record<ToastTone, string> = {
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-amber-400'
}

function ToastCard({ item }: { item: ToastItem }) {
  useEffect(() => {
    if (item.duration <= 0) return
    const timer = window.setTimeout(() => toast.dismiss(item.id), item.duration)
    return () => window.clearTimeout(timer)
  }, [item.id, item.duration])

  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'animate-fade-in pointer-events-auto flex items-center gap-3 rounded-card border px-4 py-2.5 text-sm shadow-overlay',
        TONE_CLASS[item.tone]
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASS[item.tone])} aria-hidden="true" />
      <span className="min-w-0 flex-1 leading-5">{item.message}</span>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            void item.action?.onClick()
            toast.dismiss(item.id)
          }}
          className="transition-ink shrink-0 rounded-md bg-amber-500 px-3 py-1 text-xs font-medium text-stone-900 hover:bg-amber-400"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="关闭提示"
        onClick={() => toast.dismiss(item.id)}
        className="transition-ink shrink-0 rounded px-1 text-xs opacity-60 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  )
}

/** 需在应用根部挂载一次 */
export function ToastHost() {
  const items = useToastStore((s) => s.items)
  if (items.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex flex-col items-center gap-2 px-4">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  )
}
