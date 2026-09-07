/// <reference types="vite/client" />
import type { ZhumoraApi } from '../../shared/ipc'

declare global {
  interface Window {
    zhumora: ZhumoraApi
  }
}

export {}
