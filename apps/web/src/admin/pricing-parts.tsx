// Near-expiry discount setting block of the inventory page (FE 7.5): shown with PRICING_READ, editable with PRICING_MANAGE.
import { useState } from 'react'
import { ApiError } from '../api/client.ts'
import { pricingApi } from '../api/resources.ts'
import type { NearExpiryDiscount } from '../api/resources.ts'
import { Button } from '../components/ui/button.tsx'
import { FormField } from '../components/ui/form-field.tsx'
import { Input } from '../components/ui/input.tsx'
import { formatDateTime } from '../lib/format.ts'
import { FormSheet, useForm } from './kit.tsx'
import { PRICING_LIMITS, pricingBody, pricingError, pricingText, pricingValues, validatePricing } from './pricing.ts'
import type { PricingValues } from './pricing.ts'
import { errorMessage, useApi } from './useApi.ts'
import { useSession } from './useSession.ts'

const BOX = 'mb-4 flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-[13px]'

export function DiscountSetting() {
  const { can } = useSession()
  const canRead = can('PRICING_READ'), canManage = can('PRICING_MANAGE')
  const state = useApi(signal => (canRead ? pricingApi.get(signal) : Promise.resolve(undefined)), `pricing|${canRead}`)
  const [editing, setEditing] = useState(false)
  if (!canRead) return null
  const setting = state.data
  // A 403 means the role lost PRICING_READ since sign-in: nothing to show.
  if (!setting && state.error instanceof ApiError && state.error.status === 403) return null
  return <section aria-labelledby="discount-setting-title" className={BOX}>
    <div className="grid min-w-0 gap-0.5">
      <h2 id="discount-setting-title" className="font-semibold">Giảm giá hộp hết hạn trong ngày</h2>
      {setting ? <>
        <p>{pricingText(setting)}</p>
        <p className="text-muted-foreground">Cập nhật {formatDateTime(setting.updatedAt)}{setting.updatedBy?.fullName ? ` bởi ${setting.updatedBy.fullName}` : ''}. Hộp được giảm có nhãn “Giảm giá hôm nay”.</p>
      </> : state.error
        ? <p role="alert" className="text-destructive">Không đọc được cài đặt giảm giá: {errorMessage(state.error)} <Button type="button" variant="link" className="h-auto p-0" onClick={state.reload}>Thử lại</Button></p>
        : <p className="text-muted-foreground">Đang tải cài đặt giảm giá…</p>}
    </div>
    {setting && canManage && <Button type="button" variant="outline" size="sm" className="max-sm:h-11" data-focus-key="discount-edit" onClick={() => setEditing(true)}>Sửa cài đặt</Button>}
    {editing && setting && <DiscountSheet setting={setting} close={() => setEditing(false)} saved={state.reload} />}
  </section>
}

function DiscountSheet({ setting, close, saved }: { setting: NearExpiryDiscount; close: () => void; saved: () => void }) {
  const form = useForm<PricingValues>(pricingValues(setting))
  const { values, errors } = form
  return <FormSheet title="Giảm giá hộp hết hạn trong ngày" submitLabel="Lưu cài đặt" close={close} onFieldErrors={form.setErrors}
    successMessage="Đã lưu cài đặt giảm giá" successDescription={values.enabled === 'true' ? `Giảm ${values.percent} %` : 'Đã tắt giảm giá'}
    description="Áp dụng ngay cho kiosk và đơn mới; đơn đã tạo giữ nguyên giá. Ngày tính theo giờ Việt Nam."
    onSubmit={async () => {
      const problems = validatePricing(values)
      if (Object.keys(problems).length) form.fail(problems)
      const body = pricingBody(setting, values)
      if (!body) throw new Error('Chưa có thay đổi nào để lưu. Đổi một ô rồi bấm “Lưu cài đặt”, hoặc bấm Hủy.')
      try { await pricingApi.update(body) } catch (error) {
        if (error instanceof ApiError && error.status === 409) saved()
        throw pricingError(error)
      }
      saved()
    }}>
    <label className="mb-4 flex min-h-11 items-center gap-2 text-[14px]">
      <input type="checkbox" className="size-4 accent-primary" checked={values.enabled === 'true'} onChange={event => form.set('enabled')(event.target.checked ? 'true' : 'false')} />
      Bật giảm giá cho hộp có lô hết hạn trong ngày
    </label>
    <FormField label="Mức giảm (%)" required error={errors.percent} hint={`Số nguyên từ ${PRICING_LIMITS.min} đến ${PRICING_LIMITS.max}. Giá sau giảm làm tròn xuống đồng.`}>
      <Input type="number" inputMode="numeric" min={PRICING_LIMITS.min} max={PRICING_LIMITS.max} step={1} value={values.percent} className="max-sm:h-11 max-sm:text-base"
        onChange={event => form.set('percent')(event.target.value)} />
    </FormField>
  </FormSheet>
}
