import { Children, cloneElement, Fragment, isValidElement, useId } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

interface ControlProps { id?: string; disabled?: boolean; 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean }

interface FormFieldProps {
  label: string
  hint?: string
  /** Replaces the hint and marks the control invalid. */
  error?: string
  required?: boolean
  disabled?: boolean
  id?: string
  className?: string
  /** One control (`Input`, `NativeSelect`, `Textarea` or a plain element); it receives the id and ARIA links. */
  children: ReactNode
}

/** Label, control and message wired together: `htmlFor`, `aria-describedby`, `aria-invalid`. */
export function FormField({ label, hint, error, required = false, disabled = false, id, className, children }: FormFieldProps) {
  const generated = useId()
  const control = Children.count(children) === 1 && isValidElement<ControlProps>(children) && children.type !== Fragment ? children : undefined
  const controlId = id ?? control?.props.id ?? generated
  const messageId = `${controlId}-message`
  const message = error || hint
  const describedBy = [control?.props['aria-describedby'], message ? messageId : undefined].filter(Boolean).join(' ') || undefined
  return <div data-slot="form-field" className={cn('flex min-w-0 flex-col gap-1.5 font-medium', '**:aria-invalid:border-destructive!', className)}>
    <label htmlFor={control ? controlId : undefined} className={cn('text-[13px]', disabled && 'text-muted-foreground')}>
      {label}{required && <span aria-hidden="true" className="text-destructive"> *</span>}
    </label>
    {control ? cloneElement(control, {
      id: controlId,
      disabled: disabled || control.props.disabled,
      'aria-describedby': describedBy,
      'aria-invalid': error ? true : control.props['aria-invalid'],
      'aria-required': required || control.props['aria-required'],
    }) : children}
    {error
      // No role="alert": the message is read with the field through aria-describedby when focus moves there, and a
      // live region would announce it a second time. Form-level alerts keep role="alert".
      ? <small id={messageId} className="text-xs font-medium text-destructive">{error}</small>
      : hint && <small id={messageId} className="text-xs font-normal text-muted-foreground">{hint}</small>}
  </div>
}
