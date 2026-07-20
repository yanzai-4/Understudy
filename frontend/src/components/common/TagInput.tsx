import { useRef, useState } from 'react'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
  placeholder?: string
}

/** Chip-style tag editor: Enter/comma adds, Backspace removes, click a suggestion to add. */
export default function TagInput({ value, onChange, suggestions = [], placeholder }: Props) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const add = (raw: string) => {
    const tag = raw.trim()
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setText('')
  }

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag))

  const available = suggestions.filter(
    (s) => !value.includes(s) && s.toLowerCase().includes(text.toLowerCase()),
  )

  return (
    <div className="relative">
      <div
        className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-night-600 bg-night-900 px-2 py-1.5 focus-within:border-accent"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-md bg-night-700 px-2 py-0.5 text-xs text-cyan-200"
          >
            {tag}
            <button
              type="button"
              onClick={() => remove(tag)}
              className="text-slate-500 hover:text-slate-200"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(text)
            } else if (e.key === 'Backspace' && !text && value.length) {
              remove(value[value.length - 1])
            }
          }}
          placeholder={value.length === 0 ? placeholder : ''}
          className="min-w-[80px] flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none"
        />
      </div>
      {focused && available.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-36 w-full overflow-y-auto rounded-lg border border-night-600 bg-night-850 py-1 shadow-xl shadow-black/50">
          {available.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                add(s)
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-slate-300 hover:bg-night-700"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
