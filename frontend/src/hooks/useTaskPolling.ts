import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { TaskSnapshot } from '../api/types'

/**
 * Polls /api/tasks/{id} every 800ms until the task reaches a terminal state.
 * Pass null to idle. onDone fires exactly once per task id.
 */
export function useTaskPolling(
  taskId: string | null,
  onDone?: (task: TaskSnapshot) => void,
): TaskSnapshot | null {
  const [task, setTask] = useState<TaskSnapshot | null>(null)
  const doneRef = useRef<string | null>(null)

  useEffect(() => {
    if (!taskId) {
      setTask(null)
      return
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const snapshot = await api.get<TaskSnapshot>(`/api/tasks/${taskId}`)
        if (stopped) return
        setTask(snapshot)
        if (['done', 'error', 'cancelled'].includes(snapshot.status)) {
          if (doneRef.current !== taskId) {
            doneRef.current = taskId
            onDone?.(snapshot)
          }
          return
        }
      } catch {
        /* transient network error: keep polling */
      }
      timer = setTimeout(tick, 800)
    }
    tick()

    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [taskId]) // eslint-disable-line react-hooks/exhaustive-deps

  return task
}
