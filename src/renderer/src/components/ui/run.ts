import { toast } from './Toast'

/**
 * 统一异步包装（M13-A）：所有 handler 走这里，失败一律落到界面（toast）。
 * 与 appStore 里的 guard/guardOk 同源，目的都是杜绝「失败仍报成功」。
 */
export async function run<T>(
  fn: () => Promise<T>,
  options?: { errorPrefix?: string; onError?: (message: string) => void }
): Promise<T | undefined> {
  try {
    return await fn()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const text = options?.errorPrefix ? `${options.errorPrefix}：${message}` : message
    if (options?.onError) options.onError(text)
    else toast.error(text)
    return undefined
  }
}
