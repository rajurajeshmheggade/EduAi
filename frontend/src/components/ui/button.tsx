import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 ' +
    'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-glow hover:brightness-110 hover:-translate-y-px',
        secondary: 'bg-ink-700/70 text-ink-100 border border-line hover:bg-ink-700 hover:border-line-strong',
        ghost: 'text-ink-300 hover:bg-ink-800 hover:text-fg',
        outline: 'border border-brand-400/40 text-brand-300 hover:bg-brand-500/10',
        danger: 'bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25',
      },
      size: { default: 'h-10 px-4', sm: 'h-8 px-3 text-xs', lg: 'h-12 px-6 text-base', icon: 'h-9 w-9' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = 'button', ...p }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...p} />
))
Button.displayName = 'Button'
