import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

/**
 * 兼容常量（M13 之前各页沿用）。
 * 保留是为了「先收口、后替换」不引入回归；新代码请直接用 <Button>/<Input>/<Labeled>。
 * @deprecated 使用 <Button variant="primary"> 代替
 */
export const BUTTON_PRIMARY =
  'rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40'

/** @deprecated 使用 <Button variant="secondary"> 代替 */
export const BUTTON_GHOST =
  'rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40'

/** @deprecated 使用 <Input>/<Textarea> 代替 */
export const INPUT_CLASS =
  'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-amber-500'

const FIELD_CLASS =
  'transition-ink w-full rounded-lg border border-ink-border bg-ink-surface px-3 py-2 text-sm text-ink-text outline-none focus:border-ink-primary placeholder:text-ink-subtle disabled:opacity-50'

export interface LabeledProps {
  label: string
  hint?: string
  htmlFor?: string
  children: ReactNode
}

/** 统一字段容器：标签 + 可选提示 + 控件 */
export function Labeled({ label, hint, htmlFor, children }: LabeledProps) {
  return (
    <label className="flex flex-col gap-1.5" htmlFor={htmlFor}>
      <span className="text-xs text-ink-muted">
        {label}
        {hint && <span className="ml-2 text-ink-subtle">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_CLASS, className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_CLASS, 'leading-6', className)} {...rest} />
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(FIELD_CLASS, className)} {...rest} />
}
