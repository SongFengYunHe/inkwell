import type { InkwellApi } from '../shared/types'

declare global {
  interface Window {
    inkwell: InkwellApi
  }
}

export {}