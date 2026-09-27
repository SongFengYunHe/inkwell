import type { ReactNode } from 'react'

export const INPUT_CLASS =
  'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-amber-500'

export const BUTTON_PRIMARY =
  'rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40'

export const BUTTON_GHOST =
  'rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40'

export function Labeled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-stone-500">
        {label}
        {hint && <span className="ml-2 text-stone-400">{hint}</span>}
      </span>
      {children}
    </label>
  )
}