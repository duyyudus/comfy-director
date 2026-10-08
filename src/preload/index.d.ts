import type { ToolkitApi } from '../shared/api'
import type { AppEvent } from '../shared/types'

declare global {
  interface Window {
    toolkit: {
      api: ToolkitApi
      onEvent(cb: (e: AppEvent) => void): () => void
      pathForFile(file: File): string
      platform: string
    }
  }
}
export {}
