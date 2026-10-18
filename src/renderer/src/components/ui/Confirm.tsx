import { create } from 'zustand'
import { Button } from './Button'
import { Modal } from './Modal'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  /** 危险动作默认红色确定键，且焦点默认落在「取消」 */
  variant?: 'primary' | 'danger'
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

interface ConfirmState {
  request: ConfirmRequest | null
  open: (request: ConfirmRequest) => void
  close: (ok: boolean) => void
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  open: (request) => set({ request }),
  close: (ok) => {
    const current = get().request
    set({ request: null })
    current?.resolve(ok)
  }
}))

/**
 * 统一确认框（命令式）。
 * 用法：`if (!(await confirmDialog({ title: '…' }))) return`
 * 用来取代 `window.confirm`（Electron 下的原生弹窗样式不可控、且无法统一文案）。
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore
      .getState()
      .open({ variant: 'primary', confirmText: '确定', cancelText: '取消', ...options, resolve })
  })
}

/** 需在应用根部挂载一次 */
export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request)
  const close = useConfirmStore((s) => s.close)
  if (!request) return null

  return (
    <Modal
      title={request.title}
      size="sm"
      dismissable
      onClose={() => close(false)}
      footer={
        <>
          {/* 取消在前并自动聚焦：危险动作的默认焦点必须是「取消」 */}
          <Button data-autofocus variant="secondary" onClick={() => close(false)}>
            {request.cancelText}
          </Button>
          <Button variant={request.variant === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
            {request.confirmText}
          </Button>
        </>
      }
    >
      {request.message && <p className="text-sm leading-6 text-ink-muted whitespace-pre-line">{request.message}</p>}
    </Modal>
  )
}
