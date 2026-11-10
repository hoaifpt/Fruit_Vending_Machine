import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn.ts'
import { Input } from './input.tsx'

/**
 * Password input with a show/hide toggle. Works as a `FormField` child: id and ARIA props land on the <input>.
 * The toggle is a real button (Tab, Enter/Space): a fixed label "Hiện mật khẩu" plus `aria-pressed` for its state.
 */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = useState(false)
  const Icon = visible ? EyeOff : Eye
  return <div data-slot="password-input" className="relative min-w-0">
    <Input {...props} type={visible ? 'text' : 'password'} className={cn('pr-12', className)} />
    <button type="button" aria-label="Hiện mật khẩu" aria-pressed={visible} aria-controls={props.id}
      disabled={props.disabled}
      onClick={() => setVisible(value => !value)}
      className="absolute inset-y-0 right-0.5 my-auto grid size-11 place-items-center rounded-md text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-offset-[-3px]! disabled:pointer-events-none disabled:opacity-50">
      <Icon className="size-5" aria-hidden="true" />
    </button>
  </div>
}
