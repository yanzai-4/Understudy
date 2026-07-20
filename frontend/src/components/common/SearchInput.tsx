import { useEffect, useState } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

/** Debounced search box (300ms). */
export default function SearchInput({ value, onChange, placeholder, className = '' }: Props) {
  const [text, setText] = useState(value)

  useEffect(() => setText(value), [value])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (text !== value) onChange(text)
    }, 300)
    return () => clearTimeout(timer)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`relative ${className}`}>
      <svg
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-night-600 bg-night-900 py-1.5 pl-8 pr-3 text-sm text-slate-200 placeholder:text-slate-600 focus:border-accent focus:outline-none"
      />
    </div>
  )
}
