import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface DropdownItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

const MENU_WIDTH = 144 // w-36

/**
 * Small "…" context menu. The menu is rendered in a portal with fixed
 * positioning so it escapes the card's `overflow-hidden` clipping and any
 * sibling stacking contexts (adjacent cards would otherwise paint over it).
 */
export default function Dropdown({ items, trigger }: { items: DropdownItem[]; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const place = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
    setPos({ top: rect.bottom + 4, left })
  }

  useLayoutEffect(() => {
    if (open) place()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    // Any scroll/resize invalidates the fixed position — just close.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="rounded-md p-1 text-slate-500 transition hover:bg-night-700 hover:text-slate-200"
      >
        {trigger ?? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="z-50 rounded-lg border border-night-600 bg-night-850 py-1 shadow-xl shadow-black/50"
          >
            {items.map((item) => (
              <button
                key={item.label}
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                  item.onClick()
                }}
                className={`block w-full px-3 py-1.5 text-left text-xs transition disabled:opacity-40 ${
                  item.danger ? 'text-red-400 hover:bg-red-950/40' : 'text-slate-300 hover:bg-night-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
