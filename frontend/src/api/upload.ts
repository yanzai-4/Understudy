import type { Shot } from './types'
import { ApiError } from './client'

/** Upload with progress via XHR (fetch has no upload progress events). */
export function uploadVideo(
  shotId: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<Shot> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/shots/${shotId}/video`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText))
      } else {
        let code = 'upload_failed'
        let message = xhr.statusText
        try {
          const body = JSON.parse(xhr.responseText)
          if (body?.detail?.code) {
            code = body.detail.code
            message = body.detail.message
          }
        } catch {
          /* ignore */
        }
        reject(new ApiError(xhr.status, code, message))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, 'network_error', 'Network error during upload'))
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}
