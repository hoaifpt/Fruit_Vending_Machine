// A3 Vai trò & quyền (issue FE 3.2): permission × role matrix grouped like backend #48, edited in memory and saved once.
// "Lưu" sends PUT /roles/{id}/permissions (whole set) for each role that changed, after checking nobody else changed those
// roles meanwhile. The result says, per role, which permissions were added and removed (aria-live). Guard: PERMISSION_MANAGE.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Lock, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { rolesApi } from '../../api/resources.ts'
import type { PermissionInfo, RoleWithPermissions } from '../../api/resources.ts'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from '../../components/ui/alert-dialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { setLeaveGuard } from '../../lib/router.ts'
import { ErrorState, PageHead, TableSkeleton } from '../kit.tsx'
import { useReturnFocus } from '../return-focus.ts'
import {
  cellChange, changeCount, sameGrants, describeSaveError, diffGrants, grantsOf, groupPermissions, hasGrant, lockReason,
  permissionLabel, replaceBody, roleLabel, ROLE_SAVE_TEXT, sortRoles, staleRoles, toggleGrant,
} from '../roles.ts'
import type { Grants, PermissionGroup, RoleChange } from '../roles.ts'
import { errorMessage, useApi } from '../useApi.ts'

// Honest about the web: the server applies a change at the member's next request, but this web still derives menus and
// screens from the role (src/admin/permissions.ts) until the session-info API (GET /auth/me) exists.
const SUBTITLE = 'Mỗi vai trò là một tập quyền. Đánh dấu để cấp, bỏ dấu để thu hồi; thay đổi chỉ gửi đi khi bấm Lưu. Máy chủ áp dụng ngay từ yêu cầu kế tiếp của mọi tài khoản thuộc vai trò; riêng menu và các trang trên web của các tài khoản đó sẽ cập nhật khi hệ thống có API thông tin phiên đăng nhập. Không tạo, đổi tên hay xóa được vai trò.'
const APPLY_NOTE = 'Máy chủ áp dụng ngay từ yêu cầu kế tiếp của mọi tài khoản thuộc vai trò. Menu và các trang trên web của họ chưa đổi theo cho tới khi hệ thống có API thông tin phiên đăng nhập; trong lúc đó thao tác bị thu hồi sẽ bị máy chủ từ chối kèm lời giải thích.'
const LEAVE_QUESTION = 'Bạn có thay đổi quyền chưa lưu. Rời trang và bỏ các thay đổi này?'

interface Loaded { roles: RoleWithPermissions[]; catalog: PermissionInfo[] }
/** Outcome shown in the live region: what the last save applied and, when a role failed, why; or a reload notice. */
type SaveResult = { kind: 'saved'; at: string; applied: RoleChange[]; failure?: string } | { kind: 'reloaded'; at: string }

function RolesPage() {
  const state = useApi<Loaded>(signal => Promise.all([rolesApi.list(signal), rolesApi.permissions(signal)]).then(([roles, catalog]) => ({ roles: sortRoles(roles ?? []), catalog: catalog ?? [] })), 'roles')
  const data = state.data
  // A (re)load replaces both the saved state and the draft: the screen always starts from what the server has.
  // Adjusted while rendering (React's "state from props" pattern), not in an effect, so no stale frame is shown.
  const [source, setSource] = useState<Loaded | undefined>(undefined)
  const [saved, setSaved] = useState<Grants>({})
  const [draft, setDraft] = useState<Grants>({})
  if (data && data !== source) {
    const grants = grantsOf(data.roles)
    setSource(data)
    // A load that brings back what is already saved keeps the user's draft; a different server state replaces both.
    if (!sameGrants(grants, saved)) { setSaved(grants); setDraft(grants) }
  }
  const [result, setResult] = useState<SaveResult | null>(null)
  const [confirming, setConfirming] = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)
  const roles = useMemo(() => data?.roles ?? [], [data])
  const groups = useMemo(() => groupPermissions(data?.catalog ?? []), [data])
  const labelOf = useMemo(() => {
    const descriptions = new Map((data?.catalog ?? []).map(item => [item.code ?? '', item.description]))
    return (code: string) => permissionLabel(code, descriptions.get(code))
  }, [data])

  const changes = useMemo(() => diffGrants(roles, saved, draft), [roles, saved, draft])
  const dirty = changes.length > 0

  // Unsaved changes: ask before leaving the screen (in-app links, back button, logout) or closing the tab.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    const removeGuard = setLeaveGuard(() => window.confirm(LEAVE_QUESTION))
    return () => { removeGuard(); window.removeEventListener('beforeunload', onBeforeUnload) }
  }, [dirty])

  const toggle = useCallback((roleId: string, code: string, on: boolean) => setDraft(current => toggleGrant(current, roleId, code, on)), [])
  const undo = () => setDraft(saved)
  const reload = () => { setResult(null); state.reload() }

  function onSaved(applied: { change: RoleChange; role: RoleWithPermissions }[], failure?: string) {
    if (!applied.length) return
    // Saved state of each applied role comes from the server's answer; its draft follows. Failed roles keep their draft.
    const confirmed: RoleChange[] = []
    const nextSaved: Record<string, readonly string[]> = { ...saved }
    const nextDraft: Record<string, readonly string[]> = { ...draft }
    for (const { change, role } of applied) {
      const after = grantsOf([{ ...role, id: change.roleId }])
      confirmed.push(...diffGrants([{ id: change.roleId, name: role.name ?? change.roleName }], saved, after))
      nextSaved[change.roleId] = after[change.roleId]
      nextDraft[change.roleId] = after[change.roleId]
    }
    setSaved(nextSaved); setDraft(nextDraft)
    setResult({ kind: 'saved', at: new Date().toISOString(), applied: confirmed, failure })
    // Short toast only: the details are in the live region, so screen readers do not hear them twice.
    if (failure) toast.warning('Mới lưu được một phần')
    else toast.success('Đã lưu quyền')
  }

  const forbidden = state.error && !data
  return <>
    <PageHead title="Vai trò & quyền"
      subtitle={SUBTITLE} />

    {/* Always mounted so screen readers announce the save outcome when it appears. */}
    <div ref={resultRef} id="roles-save-result" tabIndex={-1} role="status" aria-live="polite" aria-atomic="true" className="rounded-lg outline-none focus:ring-3 focus:ring-ring/50">
      {result && <SaveSummary result={result} labelOf={labelOf} />}
    </div>

    {forbidden
      ? <ErrorState error={state.error} retry={state.reload} />
      : !data
        ? <TableSkeleton columns={3} rows={8} />
        : !roles.length || !groups.length
          ? <div className="rounded-xl border bg-card px-4 py-10 text-center text-muted-foreground">
            <p>{!roles.length ? 'Máy chủ chưa trả về vai trò nào.' : 'Danh mục quyền đang trống.'} Vai trò và quyền được tạo sẵn khi cài đặt hệ thống; hãy báo bộ phận kỹ thuật nếu tình trạng này kéo dài.</p>
            <p className="mt-3!"><Button type="button" variant="outline" size="sm" onClick={reload}>Tải lại</Button></p>
          </div>
          : <>
            {state.error && <ErrorState error={state.error} retry={reload} />}
            <Matrix roles={roles} groups={groups} saved={saved} draft={draft} disabled={confirming} onToggle={toggle} />
            <ActionBar changes={changes} onUndo={undo} onSave={() => setConfirming(true)} />
          </>}

    {confirming && <ConfirmSave changes={changes} saved={saved} draft={draft} labelOf={labelOf} resultRef={resultRef}
      close={() => setConfirming(false)} onSaved={onSaved}
      onReload={() => { setConfirming(false); setDraft(saved); setResult({ kind: 'reloaded', at: new Date().toISOString() }); state.reload() }} />}
  </>
}

function SaveSummary({ result, labelOf }: { result: SaveResult; labelOf: (code: string) => string }) {
  if (result.kind === 'reloaded') return <p className="mb-4! rounded-lg border bg-muted/40 px-3.5 py-3 text-sm">
    Đã tải lại quyền mới nhất từ máy chủ lúc {formatDateTime(result.at)}; các thay đổi chưa lưu của bạn đã được bỏ. Hãy chọn lại nếu vẫn cần.
  </p>
  const ok = !result.failure
  return <div className={cn('mb-4 rounded-lg border px-3.5 py-3 text-sm', ok ? 'border-primary/30 bg-primary/8' : 'border-destructive/30 bg-destructive/8')}>
    <p className="font-medium">{ok ? `Đã lưu quyền lúc ${formatDateTime(result.at)}.` : `Mới lưu được một phần lúc ${formatDateTime(result.at)}.`}</p>
    {result.applied.length > 0 && <ChangeList changes={result.applied} labelOf={labelOf} className="mt-1.5" />}
    {result.failure && <p className="mt-1.5! text-destructive">Chưa lưu: {result.failure}</p>}
  </div>
}

/** Per role: the permissions added and removed, as readable lists. */
function ChangeList({ changes, labelOf, className }: { changes: RoleChange[]; labelOf: (code: string) => string; className?: string }) {
  return <ul className={cn('grid gap-1.5', className)}>
    {changes.map(change => <li key={change.roleId}>
      <span className="font-medium">{roleLabel(change.roleName)}</span>
      {change.added.length > 0 && <span> · thêm: {change.added.map(labelOf).join(', ')}</span>}
      {change.removed.length > 0 && <span> · bỏ: {change.removed.map(labelOf).join(', ')}</span>}
    </li>)}
  </ul>
}

function Matrix({ roles, groups, saved, draft, disabled, onToggle }: {
  roles: RoleWithPermissions[]; groups: PermissionGroup[]; saved: Grants; draft: Grants; disabled: boolean
  onToggle: (roleId: string, code: string, on: boolean) => void
}) {
  const baseId = useId()
  return <div className="w-full overflow-x-auto rounded-xl border bg-card">
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">Ma trận quyền: hàng là quyền theo nhóm, cột là vai trò</caption>
      <thead>
        <tr>
          <th scope="col" className="border-b bg-muted px-3 py-2.5 text-xs font-medium text-muted-foreground">Quyền</th>
          {roles.map(role => <th key={role.id} scope="col" className="w-28 border-b bg-muted px-2 py-2.5 text-center text-xs font-medium text-muted-foreground sm:w-36">
            <span className="block text-foreground">{roleLabel(role.name)}</span>
            <span className="font-mono text-[11px]">{role.name}</span>
          </th>)}
        </tr>
      </thead>
      {groups.map(group => <tbody key={group.key}>
        <tr>
          <th scope="colgroup" colSpan={roles.length + 1} className="border-b bg-muted/50 px-3 pt-3.5 pb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.label}</th>
        </tr>
        {group.permissions.map(permission => {
          const reasons = roles.map(role => lockReason(role.name, permission.code, hasGrant(saved, role.id!, permission.code) && hasGrant(draft, role.id!, permission.code)))
          const reasonId = `${baseId}-${permission.code}-lock`
          const reason = reasons.find(Boolean)
          return <tr key={permission.code} className="transition-colors duration-150 hover:bg-muted/40">
            <th scope="row" className="border-b px-3 py-2.5 align-middle font-normal">
              <span className="block font-medium">{permission.label}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{permission.code}</span>
              {reason && <span id={reasonId} className="mt-1 flex items-start gap-1 text-xs text-muted-foreground"><Lock aria-hidden="true" className="mt-0.5 size-3 shrink-0" />{reason}</span>}
            </th>
            {roles.map((role, index) => <Cell key={role.id} roleId={role.id!} roleName={role.name} code={permission.code} label={permission.label}
              checked={hasGrant(draft, role.id!, permission.code)} change={cellChange(saved, draft, role.id!, permission.code)}
              locked={!!reasons[index]} reasonId={reasonId} disabled={disabled} onToggle={onToggle} />)}
          </tr>
        })}
      </tbody>)}
    </table>
  </div>
}

function Cell({ roleId, roleName, code, label, checked, change, locked, reasonId, disabled, onToggle }: {
  roleId: string; roleName: string | undefined; code: string; label: string; checked: boolean; change: 'added' | 'removed' | undefined
  locked: boolean; reasonId: string; disabled: boolean; onToggle: (roleId: string, code: string, on: boolean) => void
}) {
  const changeId = useId()
  const describedBy = [locked ? reasonId : '', change ? changeId : ''].filter(Boolean).join(' ') || undefined
  return <td data-change={change} className={cn('border-b px-2 py-1.5 text-center align-middle', change === 'added' && 'bg-status-success', change === 'removed' && 'bg-status-danger')}>
    <label className={cn('mx-auto flex min-h-10 min-w-10 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md px-1', locked && 'cursor-not-allowed', 'has-focus-visible:ring-3 has-focus-visible:ring-ring/40')}>
      <input type="checkbox" data-slot="checkbox" checked={checked} disabled={disabled}
        aria-label={`${roleLabel(roleName)}: ${label}`} aria-describedby={describedBy} aria-disabled={locked || undefined}
        onClick={event => { if (locked) event.preventDefault() }}
        onChange={event => { if (!locked) onToggle(roleId, code, event.target.checked) }}
        className={cn('size-4.5 shrink-0 scroll-mt-20 scroll-mb-40 accent-primary outline-none sm:scroll-mb-28', locked && 'opacity-60')} />
      {change && <span id={changeId} className={cn('text-[11px] leading-tight font-medium', change === 'added' ? 'text-status-success-foreground' : 'text-status-danger-foreground')}>
        {change === 'added' ? 'Sẽ thêm' : 'Sẽ bỏ'}<span className="sr-only"> (chưa lưu)</span>
      </span>}
    </label>
  </td>
}

/** Sticky at the bottom so Lưu/Hoàn tác stay in reach on a long matrix. */
function ActionBar({ changes, onUndo, onSave }: { changes: RoleChange[]; onUndo: () => void; onSave: () => void }) {
  const count = changeCount(changes)
  return <div data-roles-actions className="sticky bottom-0 z-10 -mx-1 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 px-3.5 py-3 shadow-sm backdrop-blur-sm">
    <p className="text-sm text-muted-foreground">
      {count ? <><strong className="font-medium text-foreground">{count} thay đổi chưa lưu</strong> ở {changes.length} vai trò.</> : 'Chưa có thay đổi nào.'}
    </p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={!count} onClick={onUndo}><RotateCcw aria-hidden="true" />Hoàn tác thay đổi</Button>
      <Button type="button" disabled={!count} data-focus-key="roles-save" onClick={onSave}><Save aria-hidden="true" />Lưu thay đổi</Button>
    </div>
  </div>
}

/**
 * Lists what will change, then saves. First re-reads the roles: a role changed elsewhere since the page loaded stops the
 * save (PUT replaces the whole set and would silently undo that change). Then one PUT per changed role, in order; a failing
 * role stops the rest and its reason is shown. Stays open (with the reason) when nothing could be saved.
 */
function ConfirmSave({ changes, saved, draft, labelOf, resultRef, close, onSaved, onReload }: {
  changes: RoleChange[]; saved: Grants; draft: Grants; labelOf: (code: string) => string; resultRef: RefObject<HTMLDivElement | null>
  close: () => void; onSaved: (applied: { change: RoleChange; role: RoleWithPermissions }[], failure?: string) => void; onReload: () => void
}) {
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState('')
  const [stale, setStale] = useState(false)
  /** Focus the outcome region on close: after a save (the Lưu button is then disabled) or a reload (the draft is gone). */
  const focusOutcome = useRef(false)
  const { restore } = useReturnFocus()
  // After a save the Lưu button is disabled (nothing left to save): focus goes to the outcome instead.
  const onCloseAutoFocus = (event: Event) => { event.preventDefault(); if (focusOutcome.current && resultRef.current) resultRef.current.focus({ preventScroll: false }); else restore() }

  async function save() {
    if (pending) return
    setPending(true); setFailure(''); setStale(false)
    try {
      const outdated = staleRoles(changes, saved, sortRoles(await rolesApi.list()))
      if (outdated.length) {
        setFailure(`${outdated.map(change => roleLabel(change.roleName)).join(', ')}: ${ROLE_SAVE_TEXT.stale}`)
        setStale(true); setPending(false); return
      }
    } catch (error) {
      setFailure(errorMessage(error)); setPending(false); return
    }
    const applied: { change: RoleChange; role: RoleWithPermissions }[] = []
    let problem: string | undefined
    for (const change of changes) {
      try { applied.push({ change, role: await rolesApi.replacePermissions(change.roleId, replaceBody(draft[change.roleId] ?? [])) }) } catch (error) {
        problem = describeSaveError(error, change.roleName)
        break
      }
    }
    if (applied.length) {
      focusOutcome.current = true
      onSaved(applied, problem)
      close()
      return
    }
    setFailure(problem ?? 'Đã xảy ra lỗi. Vui lòng thử lại.'); setPending(false)
  }

  return <AlertDialog open onOpenChange={open => { if (!open && !pending) close() }}>
    <AlertDialogContent aria-busy={pending} onEscapeKeyDown={event => { if (pending) event.preventDefault() }} onCloseAutoFocus={onCloseAutoFocus}>
      <AlertDialogTitle>Lưu thay đổi quyền?</AlertDialogTitle>
      <AlertDialogDescription asChild>
        <div className="grid gap-2">
          <p>Các thay đổi sẽ được lưu:</p>
          <ChangeList changes={changes} labelOf={labelOf} className="rounded-lg border bg-muted/40 px-3.5 py-2.5 text-foreground" />
          <p className="text-[13px]">{APPLY_NOTE}</p>
        </div>
      </AlertDialogDescription>
      {failure && <p className="my-1! rounded-lg border border-destructive/30 bg-destructive/8 px-3.5 py-2.5 text-sm text-destructive" role="alert">{failure}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>Hủy</AlertDialogCancel>
        {stale
          ? <Button type="button" variant="outline" onClick={() => { focusOutcome.current = true; onReload() }}>Tải lại dữ liệu (bỏ thay đổi)</Button>
          : <Button type="button" disabled={pending} onClick={save}>{pending ? 'Đang lưu…' : 'Lưu thay đổi'}</Button>}
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}

export default RolesPage
