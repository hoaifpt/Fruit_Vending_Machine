// C3 tab "Cảm biến & Sự kiện" (`?tab=sensors`, FE 6.4). One tab rather than two: everything here is what the machine
// itself reports (connectivity, last heartbeat, temperature/humidity, events), read only, and the active FAULT shown at
// the top comes from the events.
// - Kết nối và bộ điều khiển: connectivity of MachineResponse (../connection.ts) and its last heartbeat: RSSI with its
//   level in words, firmware, uptime, free heap. The machine is the page's (reloaded every 30 s), no extra request.
// - Nhiệt độ và độ ẩm: GET /telemetry/latest (LOW/NORMAL/HIGH from the server), then the history GET /telemetry with
//   from/to (range and page in the URL).
// - Sự kiện của máy: GET /events, newest first, filter by type and source in the URL; FAULT stands out with its code,
//   meaning and next step. A FAULT newer than the last FAULT_CLEARED is shown as the active fault at the top.
// API: api-contract/api.yaml, MACHINE_READ. On a backend without these paths (404) the tab says there is no data yet and
// stops asking. The latest reading, the fault check and the first page of events reload every 30 s while the tab is open
// and visible. Nothing is ever changed or deleted from here.
import { useId } from 'react'
import type { ReactNode } from 'react'
import { Droplets, OctagonAlert, Signal, SignalHigh, SignalLow, SignalMedium, SignalZero, Thermometer, TriangleAlert } from 'lucide-react'
import { ApiError } from '../../api/client.ts'
import { telemetryApi } from '../../api/resources.ts'
import type { Machine, MachineEvent, Page, TelemetryLatest, TelemetryReading } from '../../api/resources.ts'
import { Button } from '../../components/ui/button.tsx'
import { FilterBar } from '../../components/ui/filter-bar.tsx'
import { cn } from '../../lib/cn.ts'
import { formatDateTime } from '../../lib/format.ts'
import { useQueryParams } from '../../lib/router.ts'
import { ConnectionStatus } from '../connection-parts.tsx'
import { formatAge } from '../connection.ts'
import type { ConnectionSource } from '../connection.ts'
import { DataTable, ErrorState, Loading, PAGE_SIZE, Pagination, SelectFilter } from '../kit.tsx'
import type { Column } from '../kit.tsx'
import {
  EVENT_LABELS, EVENT_SOURCES, EVENT_SOURCE_LABELS, EVENT_TYPES, LATEST_CLEARED_QUERY, LATEST_FAULT_QUERY, READING_RANGES, READING_RANGE_LABELS,
  TELEMETRY_MISSING, TELEMETRY_POLL_MS, activeFault, describeFault, eventQuery, eventView, formatHeap, formatHumidity, formatRssi, formatTemperature,
  formatUptime, isTelemetryMissing, latestProblems, readSensorParams, readingProblems, readingQuery, readingStats, signalLevel,
} from '../telemetry.ts'
import type { EventSource } from '../telemetry.ts'
import type { ActiveFault } from '../telemetry.ts'
import { useApi } from '../useApi.ts'
import type { ApiState } from '../useApi.ts'

const PANEL = 'min-w-0 rounded-xl border bg-card p-5 shadow-xs max-[680px]:p-4'
const DL = 'grid grid-cols-[minmax(110px,180px)_1fr] gap-x-4 gap-y-2.5 text-sm max-[480px]:grid-cols-1 max-[480px]:gap-y-1 [&_dd]:min-w-0 [&_dd]:break-words max-[480px]:[&_dd]:mb-2 [&_dt]:text-[13px] [&_dt]:text-muted-foreground'
const POLL = { pollMs: TELEMETRY_POLL_MS, stopOn: isTelemetryMissing }
const ONCE = { stopOn: isTelemetryMissing }
/** A latest reading older than this is called out: the sensor or the machine may have stopped sending. */
const STALE_READING_MS = 15 * 60_000
const SIGNAL_ICONS = [SignalZero, SignalLow, SignalMedium, SignalHigh, Signal]
const RANGE_OPTIONS = READING_RANGES.filter(range => range !== '24h').map(range => ({ value: range, label: READING_RANGE_LABELS[range] }))
const EVENT_OPTIONS = EVENT_TYPES.map(type => ({ value: type, label: EVENT_LABELS[type] }))
const SOURCE_OPTIONS = EVENT_SOURCES.map(source => ({ value: source, label: EVENT_SOURCE_LABELS[source] }))

const statusOf = (error: unknown) => (error instanceof ApiError ? error.status : undefined)
const missingIn = (state: Pick<ApiState<unknown>, 'data' | 'error'>) => !state.data && isTelemetryMissing(state.error)

/**
 * `connection`: the page's load state of the machine. The connectivity here uses the same `lastSeenAt` and load state as
 * the page header, so both always say the same thing.
 */
export default function MachineSensorsTab({ machine, connection }: { machine: Machine; connection: ConnectionSource }) {
  const machineId = machine.id
  const { params, update } = useQueryParams()
  const view = readSensorParams(params)
  const latest = useApi(signal => telemetryApi.latest(machineId, signal), `${machineId}|latest-reading`, POLL)
  // Readings are asked from "now minus the range" at the time of the request (the key holds the range, not the time).
  const readings = useApi(signal => telemetryApi.readings(machineId, readingQuery(view.range, view.readingPage, PAGE_SIZE, Date.now()), signal),
    `${machineId}|readings|${view.range}|${view.readingPage}`, ONCE)
  // Only the first page follows new events; an older page stays still while it is being read.
  const events = useApi(signal => telemetryApi.events(machineId, eventQuery(view.eventType, view.eventPage, PAGE_SIZE, view.eventSource), signal),
    `${machineId}|events|${view.eventType}|${view.eventSource}|${view.eventPage}`, view.eventPage === 0 ? POLL : ONCE)
  // The active fault: the newest FAULT, unless a FAULT_CLEARED came after it (two one-row reads).
  const faults = useApi(signal => Promise.all([telemetryApi.events(machineId, LATEST_FAULT_QUERY, signal), telemetryApi.events(machineId, LATEST_CLEARED_QUERY, signal)]),
    `${machineId}|last-fault`, POLL)
  const fault = activeFault(faults.data?.[0].content[0], faults.data?.[1].content[0])

  const forbidden = [latest, readings, events].find(state => statusOf(state.error) === 403)?.error
  const missing = missingIn(latest) && missingIn(events)

  return <section aria-labelledby="sensors-title" className="grid gap-5">
    <div>
      <h2 id="sensors-title" className="text-base font-semibold">Cảm biến & Sự kiện</h2>
      <p className="mt-1! max-w-[70ch] text-[13px] text-muted-foreground">Những gì máy tự gửi về: tín hiệu kết nối, nhiệt độ, độ ẩm và sự kiện của bộ nhả hàng. Chỉ xem; tự làm mới mỗi 30 giây khi thẻ đang mở.</p>
    </div>
    {forbidden ? <ErrorState error={forbidden} />
      : missing ? <div role="status" className="rounded-xl border border-dashed px-4 py-5 text-muted-foreground">
        <p className="max-w-[70ch]">{TELEMETRY_MISSING}</p>
        <div className="mt-3 text-[13px]"><ConnectionStatus lastSeenAt={machine.lastSeenAt} connectivity={machine.connectivity} source={connection} /></div>
      </div>
      : <>
        {fault && <FaultBanner fault={fault} />}
        <div className="grid gap-5 min-[1100px]:grid-cols-2">
          <HeartbeatPanel machine={machine} connection={connection} />
          <LatestReadingPanel machine={machine} state={latest} />
        </div>
        <ReadingsPanel machine={machine} state={readings} range={view.range}
          onRange={value => update({ range: value || undefined, readingPage: undefined })}
          onPage={page => update({ readingPage: page ? String(page) : undefined })} />
        <EventsPanel state={events} eventType={view.eventType} eventSource={view.eventSource}
          onType={value => update({ eventType: value || undefined, eventPage: undefined })}
          onSource={value => update({ eventSource: value || undefined, eventPage: undefined })}
          onPage={page => update({ eventPage: page ? String(page) : undefined })} />
      </>}
  </section>
}

/** First load, failure or "not there yet" of one panel; null when the data is there. */
function panelState(state: Pick<ApiState<unknown>, 'data' | 'error' | 'reload'>, loadingLabel: string): ReactNode {
  if (state.data) return null
  if (missingIn(state)) return <p className="text-[13px] text-muted-foreground">Chưa có dữ liệu: máy chủ chưa hỗ trợ phần này.</p>
  if (state.error) return <ErrorState error={state.error} retry={statusOf(state.error) === 401 ? undefined : state.reload} />
  return <Loading label={loadingLabel} rows={3} />
}

/** A page past the last one (data changed meanwhile, or a hand-edited URL): say so instead of "nothing yet". */
const pastEnd = (data: Page<unknown> | undefined) => !!data && data.content.length === 0 && data.totalElements > 0
/** Tables show a failed reload with StaleNote under them, like the other panels, not as a row of the table. */
const tableState = <T,>(state: ApiState<T>) => ({ ...state, error: state.data ? undefined : state.error })

/** A failed poll keeps the last data on screen, saying it may be old. */
function StaleNote({ state }: { state: Pick<ApiState<unknown>, 'data' | 'error' | 'reload'> }) {
  if (!state.data || !state.error || isTelemetryMissing(state.error)) return null
  return <p role="alert" className="mt-3! flex flex-wrap items-center gap-2 text-[13px] text-destructive">
    Không tải lại được; đang hiện dữ liệu cũ.
    <Button type="button" size="sm" variant="outline" onClick={state.reload}>Thử lại</Button>
  </p>
}

function FaultBanner({ fault }: { fault: ActiveFault }) {
  return <section aria-labelledby="fault-title" className="rounded-xl border border-destructive/40 bg-destructive/8 px-4 py-3.5 text-[13px] text-destructive">
    <h3 id="fault-title" className="flex items-center gap-2 text-sm font-semibold">
      <OctagonAlert aria-hidden="true" className="size-4 shrink-0" />Bộ nhả hàng đang báo lỗi FAULT{fault.code ? <> · mã <span className="font-mono">{fault.code}</span></> : null}
    </h3>
    <p className="mt-1.5!">{fault.title}{fault.since ? ` Báo lúc ${formatDateTime(fault.since)}.` : ''}</p>
    <p className="mt-1!"><strong className="font-semibold">Việc cần làm:</strong> {fault.action} Trong lúc lỗi, máy từ chối mọi lệnh nhả hàng.</p>
  </section>
}

function HeartbeatPanel({ machine, connection }: { machine: Machine; connection: ConnectionSource }) {
  const titleId = useId()
  const level = signalLevel(machine.wifiRssi)
  const SignalIcon = SIGNAL_ICONS[level.bars] ?? SignalZero
  const beat = machine.lastHeartbeatAt
  return <section aria-labelledby={titleId} className={PANEL}>
    <h3 id={titleId} className="mb-3 text-sm font-semibold">Kết nối và bộ điều khiển</h3>
    <ConnectionStatus lastSeenAt={machine.lastSeenAt} connectivity={machine.connectivity} source={connection} className="mb-4" />
    {!beat && !machine.firmwareVersion
      ? <p className="text-[13px] text-muted-foreground">Máy chưa gửi nhịp heartbeat nào (mỗi 30 giây khi hoạt động). Thông tin Wi-Fi, firmware và bộ nhớ sẽ hiện ở đây khi máy bắt đầu gửi.</p>
      : <dl className={DL}>
        <dt>Heartbeat gần nhất</dt><dd>{beat ? formatDateTime(beat) : 'Chưa có'}</dd>
        <dt>Tín hiệu Wi-Fi</dt>
        <dd className={cn('inline-flex items-center gap-1.5', level.tone === 'danger' && 'font-medium text-destructive')}>
          <SignalIcon aria-hidden="true" className="size-4 shrink-0" />{formatRssi(machine.wifiRssi)}</dd>
        <dt>Firmware</dt><dd>{machine.firmwareVersion ? <span className="font-mono">{machine.firmwareVersion}</span> : 'Chưa rõ (máy chưa gửi)'}</dd>
        <dt>Thời gian chạy</dt><dd>{formatUptime(machine.uptimeSeconds)}{beat && typeof machine.uptimeSeconds === 'number' ? <span className="text-[13px] text-muted-foreground"> (tính tới {formatDateTime(beat)})</span> : null}</dd>
        <dt>Bộ nhớ trống</dt><dd>{formatHeap(machine.freeHeapBytes)}</dd>
      </dl>}
  </section>
}

function LatestReadingPanel({ machine, state }: { machine: Machine; state: ApiState<TelemetryLatest> }) {
  const titleId = useId()
  const latest = state.data
  const recordedAt = latest?.recordedAt
  const problems = latest ? latestProblems(latest, machine) : []
  // Age at the time the reading was received (render stays pure); the panel reloads every 30 s.
  const age = recordedAt && state.updatedAt ? state.updatedAt - Date.parse(recordedAt) : 0
  return <section aria-labelledby={titleId} className={PANEL}>
    <h3 id={titleId} className="mb-3 text-sm font-semibold">Nhiệt độ và độ ẩm gần nhất</h3>
    {panelState(state, 'Đang tải số đo…') ?? (!latest || !recordedAt
      ? <p className="text-[13px] text-muted-foreground">Máy chưa gửi số đo nào. Số đo xuất hiện ở đây khi cảm biến của máy bắt đầu gửi.</p>
      : <>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Measure icon={<Thermometer aria-hidden="true" className="size-5" />} label="Nhiệt độ" value={formatTemperature(latest.temperature)}
            range={`Cho phép ${formatTemperature(machine.minTemperature)} – ${formatTemperature(machine.maxTemperature)}`} />
          <Measure icon={<Droplets aria-hidden="true" className="size-5" />} label="Độ ẩm" value={formatHumidity(latest.humidity)}
            range={`Cho phép ${formatHumidity(machine.minHumidity)} – ${formatHumidity(machine.maxHumidity)}`} />
        </div>
        <p className="mt-3! text-[13px] text-muted-foreground">Đo lúc {formatDateTime(recordedAt)}{age > STALE_READING_MS ? ` · đã cũ hơn ${formatAge(age)}, máy có thể đã ngừng gửi số đo` : ''}.</p>
        {problems.length
          ? <p className="mt-2! flex gap-2 rounded-lg border border-status-warning-foreground/30 bg-status-warning px-3 py-2 text-[13px] text-status-warning-foreground">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span>{problems.join('; ')}. Kiểm tra cửa máy và hệ thống làm lạnh.</span></p>
          : <p className="mt-2! text-[13px] text-status-success-foreground">Trong ngưỡng cho phép của máy.</p>}
      </>)}
    <StaleNote state={state} />
  </section>
}

function Measure({ icon, label, value, range }: { icon: ReactNode; label: string; value: string; range: string }) {
  return <div className="grid gap-0.5">
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">{icon}{label}</span>
    <span className="text-2xl font-semibold tabular-nums">{value}</span>
    <span className="text-xs text-muted-foreground">{range}</span>
  </div>
}

function ReadingsPanel({ machine, state, range, onRange, onPage }: {
  machine: Machine; state: ApiState<Page<TelemetryReading>>; range: (typeof READING_RANGES)[number]; onRange: (value: string) => void; onPage: (page: number) => void
}) {
  const titleId = useId()
  const data = state.data
  const stats = readingStats(data?.content ?? [])
  const columns: Column<TelemetryReading>[] = [
    { head: 'Thời điểm', nowrap: true, cell: reading => formatDateTime(reading.recordedAt) },
    { head: 'Nhiệt độ', nowrap: true, cell: reading => <span className="tabular-nums">{formatTemperature(reading.temperature)}</span> },
    { head: 'Độ ẩm', nowrap: true, cell: reading => <span className="tabular-nums">{formatHumidity(reading.humidity)}</span> },
    { head: 'Đánh giá', cell: reading => {
      const problems = readingProblems(reading, machine)
      return problems.length
        ? <span className="inline-flex items-start gap-1.5 font-medium text-destructive"><TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{problems.join('; ')}</span>
        : <span className="text-muted-foreground">Trong ngưỡng</span>
    } },
  ]
  return <section aria-labelledby={titleId} className={PANEL}>
    <h3 id={titleId} className="mb-1 text-sm font-semibold">Lịch sử nhiệt độ và độ ẩm</h3>
    <p className="mb-3! text-[13px] text-muted-foreground">Mới nhất trước. Ngưỡng cho phép theo cấu hình của máy.</p>
    {missingIn(state) ? panelState(state, '') : <>
      <FilterBar activeCount={range === '24h' ? 0 : 1} onClear={() => onRange('')} clearContext="số đo">
        <SelectFilter label="Khoảng thời gian" value={range === '24h' ? '' : range} empty={READING_RANGE_LABELS['24h']} onChange={onRange} options={RANGE_OPTIONS} />
      </FilterBar>
      {data && stats.count > 0 && <p className="mb-3! text-[13px] text-muted-foreground">
        Trang này: nhiệt độ {stats.minTemperature !== undefined ? `${formatTemperature(stats.minTemperature)} – ${formatTemperature(stats.maxTemperature)}` : '—'}, độ ẩm {stats.minHumidity !== undefined ? `${formatHumidity(stats.minHumidity)} – ${formatHumidity(stats.maxHumidity)}` : '—'}.
      </p>}
      <DataTable state={tableState(state)} rows={data?.content} rowKey={reading => reading.recordedAt} columns={columns} caption="Lịch sử số đo"
        empty={pastEnd(data) ? <PastEnd onFirst={() => onPage(0)} /> : range === '30d' ? 'Không có số đo nào trong 30 ngày qua.' : <>Không có số đo trong {READING_RANGE_LABELS[range].toLowerCase()}. <Button type="button" variant="link" className="h-auto p-0" onClick={() => onRange('30d')}>Xem 30 ngày qua</Button></>} />
      {data && <Pagination page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} onPage={onPage} />}
      <StaleNote state={state} />
    </>}
  </section>
}

function PastEnd({ onFirst }: { onFirst: () => void }) {
  return <>Trang này không còn dòng nào (dữ liệu vừa thay đổi). <Button type="button" variant="link" className="h-auto p-0" onClick={onFirst}>Về trang đầu</Button></>
}

function EventsPanel({ state, eventType, eventSource, onType, onSource, onPage }: {
  state: ApiState<Page<MachineEvent>>; eventType: string; eventSource: EventSource | ''
  onType: (value: string) => void; onSource: (value: string) => void; onPage: (page: number) => void
}) {
  const titleId = useId()
  const data = state.data
  const columns: Column<MachineEvent>[] = [
    { head: 'Thời điểm', nowrap: true, cell: event => formatDateTime(event.createdAt) },
    { head: 'Sự kiện', cell: event => {
      const view = eventView(event)
      return <span className="grid justify-items-start gap-1 text-left">
        {event.eventType === 'FAULT' && <span className="inline-flex items-center gap-1 rounded-full bg-status-danger px-2 py-0.5 text-xs font-medium text-status-danger-foreground">
          <OctagonAlert aria-hidden="true" className="size-3.5 shrink-0" />FAULT{view.code ? <> · <span className="font-mono">{view.code}</span></> : null}</span>}
        <span className={cn('font-medium', view.tone === 'fault' && 'text-destructive')}>{view.label}</span>
        {view.label !== event.eventType && <span className="font-mono text-xs break-all text-muted-foreground">{event.eventType}</span>}
        <span className="text-xs text-muted-foreground">{EVENT_SOURCE_LABELS[event.source] ?? event.source}</span>
      </span>
    } },
    { head: 'Chi tiết', cell: event => {
      const view = eventView(event)
      return <span className="grid justify-items-start gap-1 text-left text-[13px]">
        {view.summary && <span>{view.summary}</span>}
        {event.eventType === 'FAULT' && <span><strong className="font-medium">Việc cần làm:</strong> {describeFault(view.code).action}</span>}
        {view.details && <details className="max-w-full">
          <summary className="cursor-pointer rounded-sm text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">{event.source === 'BACKEND' ? 'Dữ liệu hệ thống ghi' : 'Dữ liệu máy gửi'}</summary>
          {/* Untrusted machine input: shown as escaped text only. */}
          <pre tabIndex={0} className="mt-1 max-h-40 max-w-full overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-xs whitespace-pre-wrap break-all focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none">{view.details}</pre>
        </details>}
      </span>
    } },
  ]
  return <section aria-labelledby={titleId} className={PANEL}>
    <h3 id={titleId} className="mb-1 text-sm font-semibold">Sự kiện của máy</h3>
    <p className="mb-3! text-[13px] text-muted-foreground">Mới nhất trước, gồm tin máy gửi và quyết định của hệ thống về máy. Lỗi FAULT được đánh dấu đỏ kèm mã lỗi và việc cần làm.</p>
    {missingIn(state) ? panelState(state, '') : <>
      <FilterBar activeCount={(eventType ? 1 : 0) + (eventSource ? 1 : 0)} onClear={() => { onType(''); onSource('') }} clearContext="sự kiện">
        <SelectFilter label="Loại sự kiện" value={eventType} empty="Tất cả sự kiện" onChange={onType} options={EVENT_OPTIONS} />
        <SelectFilter label="Nguồn" value={eventSource} empty="Máy và hệ thống" onChange={onSource} options={SOURCE_OPTIONS} />
        <Button type="button" variant={eventType === 'FAULT' ? 'default' : 'outline'} aria-pressed={eventType === 'FAULT'} onClick={() => onType(eventType === 'FAULT' ? '' : 'FAULT')}>
          <OctagonAlert aria-hidden="true" />Chỉ lỗi FAULT</Button>
      </FilterBar>
      <DataTable state={tableState(state)} rows={data?.content} rowKey={event => event.id} columns={columns} caption="Sự kiện của máy"
        empty={pastEnd(data) ? <PastEnd onFirst={() => onPage(0)} /> : eventType || eventSource
          ? <>{eventType === 'FAULT' ? 'Máy chưa báo lỗi FAULT nào.' : 'Không có sự kiện khớp bộ lọc.'} <Button type="button" variant="link" className="h-auto p-0" onClick={() => { onType(''); onSource('') }}>Xem tất cả sự kiện</Button></>
          : 'Máy chưa gửi sự kiện nào.'} />
      {data && <Pagination page={data.page} totalPages={data.totalPages} totalElements={data.totalElements} onPage={onPage} />}
      <StaleNote state={state} />
    </>}
  </section>
}
