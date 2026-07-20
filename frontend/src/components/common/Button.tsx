import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'ghost' | 'danger'

const styles: Record<Variant, string> = {
  primary:
    'bg-accent text-white shadow-lg shadow-blue-900/40 hover:bg-accent-deep disabled:opacity-50',
  ghost:
    'border border-night-600 text-slate-300 hover:border-night-500 hover:bg-night-800 disabled:opacity-50',
  danger: 'bg-red-600/90 text-white hover:bg-red-700 disabled:opacity-50',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export default function Button({ variant = 'primary', className = '', ...rest }: Props) {
  return (
    <button
      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${styles[variant]} ${className}`}
      {...rest}
    />
  )
}
