import type { ReactNode } from 'react'

export default function EmptyState({ icon = '🎬', text, action }: { icon?: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-slate-500">
      <div className="text-4xl opacity-70">{icon}</div>
      <p className="text-sm">{text}</p>
      {action}
    </div>
  )
}
