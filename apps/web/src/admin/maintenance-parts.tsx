// Shared by the machine's maintenance tab (FE 7.4) and the restock screen (FE 7.2): reconciling a maintenance command
// the machine took but did not report (NEEDS_RECONCILIATION → RECONCILED, POST /maintenance-commands/{id}/reconcile).
import { useState } from 'react'
import { toast } from 'sonner'
import { maintenanceCommandsApi } from '../api/resources.ts'
import type { MaintenanceOperation } from '../api/resources.ts'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '../components/ui/alert-dialog.tsx'
import { Button } from '../components/ui/button.tsx'
import { FormField } from '../components/ui/form-field.tsx'
import { Textarea } from '../components/ui/input.tsx'
import { formatDateTime } from '../lib/format.ts'
import { NOTE_MAX, commandLabel, describeMaintenanceError, failureText, isRemoval, needsRefresh, reconcileBody } from './maintenance-commands.ts'
import { errorMessage } from './useApi.ts'
import { useReturnFocus } from './return-focus.ts'

const ERROR_BOX = 'rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-[13px] text-destructive'

/** Only what the dialog shows: a MaintenanceCommand, or a LinkedMaintenanceCommand of the restock view. */
export interface Reconcilable { id?: string; operation?: string; slotCode?: string | null; createdAt?: string; acceptedAt?: string | null; failureReason?: string | null }

/** NEEDS_RECONCILIATION → RECONCILED: Staff say whether the machine did the command (DONE applies its effect). */
export function ReconcileDialog({ command, close, done }: { command: Reconcilable; close: () => void; done: () => void }) {
  const [outcome, setOutcome] = useState<'DONE' | 'NOT_DONE' | ''>('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { onCloseAutoFocus } = useReturnFocus()
  const removal = isRemoval(command.operation as MaintenanceOperation)
  async function confirm() {
    if (pending) return
    const { body, errors: problems } = reconcileBody(outcome, note)
    if (!body) { setErrors(problems ?? {}); return }
    setPending(true); setFailure('')
    try {
      await maintenanceCommandsApi.reconcile(command.id!, body)
      toast.success('Đã đối soát lệnh', { description: `${commandLabel(command.operation)}${command.slotCode ? ` · ngăn ${command.slotCode}` : ''}` })
      done(); close()
    } catch (error) {
      const shown = describeMaintenanceError(error)
      setFailure(errorMessage(shown)); setPending(false)
      if (needsRefresh(error)) done()
    }
  }
  return <AlertDialog open onOpenChange={open => { if (!open && !pending) close() }}>
    <AlertDialogContent aria-busy={pending} onEscapeKeyDown={event => { if (pending) event.preventDefault() }} onCloseAutoFocus={onCloseAutoFocus}>
      <AlertDialogTitle>Đối soát lệnh “{commandLabel(command.operation)}”{command.slotCode ? ` ngăn ${command.slotCode}` : ''}</AlertDialogTitle>
      <AlertDialogDescription asChild><div className="grid gap-2">
        <p>Máy đã nhận lệnh lúc {formatDateTime(command.acceptedAt ?? command.createdAt)} nhưng không báo kết quả ({failureText(command.failureReason)}). Kiểm tra tại máy rồi chọn đúng điều đã xảy ra.</p>
        {removal && <p>Chọn “Máy đã làm” thì hộp {command.operation === 'REMOVE_ITEM' ? 'ở đáy ngăn lúc gửi lệnh' : 'của ngăn'} chuyển Đã rút; “Máy chưa làm” thì tồn kho không đổi.</p>}
      </div></AlertDialogDescription>
      <fieldset className="grid gap-2 text-[14px]" aria-invalid={!!errors.outcome || undefined}>
        <legend className="mb-1 font-medium">Kết quả tại máy <span aria-hidden="true">*</span></legend>
        {(['DONE', 'NOT_DONE'] as const).map(value => <label key={value} className="flex min-h-11 items-center gap-2">
          <input type="radio" name="reconcile-outcome" value={value} checked={outcome === value} disabled={pending} className="size-4 accent-primary"
            onChange={() => { setOutcome(value); setErrors({}) }} />
          {value === 'DONE' ? 'Máy đã làm xong' : 'Máy chưa làm'}
        </label>)}
        {errors.outcome && <span role="alert" className="text-[13px] text-destructive">{errors.outcome}</span>}
      </fieldset>
      <FormField label="Ghi chú (không bắt buộc)" error={errors.note || undefined} hint={`Đã thấy gì tại máy. Tối đa ${NOTE_MAX} ký tự.`}>
        <Textarea value={note} rows={2} disabled={pending} onChange={event => setNote(event.target.value)} />
      </FormField>
      {failure && <p className={ERROR_BOX} role="alert">{failure}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Hủy</AlertDialogCancel>
        <Button type="button" disabled={pending} onClick={confirm}>{pending ? 'Đang ghi…' : 'Ghi đối soát'}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

