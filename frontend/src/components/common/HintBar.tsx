/** One-line operation hint shown at the top of a wizard step. */
export default function HintBar({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-night-600 bg-night-900/70 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-400">
      <svg
        className="mt-0.5 shrink-0 text-cyan-400"
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5m0-8h.01" />
      </svg>
      {text}
    </div>
  )
}
