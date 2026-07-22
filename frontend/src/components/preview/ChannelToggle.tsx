import { useTranslation } from 'react-i18next'

const CHANNEL_COLORS: Record<string, string> = {
  pose: 'border-fuchsia-500/60 bg-fuchsia-950/40 text-fuchsia-300',
  depth: 'border-sky-500/60 bg-sky-950/40 text-sky-300',
  layout: 'border-teal-500/60 bg-teal-950/40 text-teal-300',
}

interface Props {
  available: string[]
  active: string[]
  onChange: (channels: string[]) => void
}

export default function ChannelToggle({ available, active, onChange }: Props) {
  const { t } = useTranslation()

  return (
    <div className="flex gap-1.5">
      {available.map((ch) => {
        const on = active.includes(ch)
        return (
          <button
            key={ch}
            onClick={() => onChange(on ? active.filter((c) => c !== ch) : [...active, ch])}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
              on
                ? CHANNEL_COLORS[ch] ?? 'border-accent/60 bg-blue-950/40 text-cyan-300'
                : 'border-night-600 text-slate-500 hover:border-night-500 hover:text-slate-300'
            }`}
          >
            {t(`extract.channel.${ch}`)}
          </button>
        )
      })}
    </div>
  )
}
