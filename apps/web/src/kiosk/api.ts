// Kiosk-facing API (tags Kiosk, Kiosk Orders, Kiosk Payments). Authenticated only by the machine-bound
// X-Kiosk-Key header — never a user JWT. The key comes from build/runtime configuration and is never
// logged or rendered.
import { requestWithMeta } from '../api/client.ts'
import type { ApiResult, RequestOptions } from '../api/client.ts'
import type { components } from '../api/schema'
import type { components as PricingDraft } from '../api/drafts/pricing-discount'

type S = components['schemas']
export type KioskIdentity = S['KioskIdentityResponse']
export type KioskCatalog = S['KioskCatalogResponse']
// Near-expiry discount fields (FE 7.5): DRAFT api-contract/drafts/pricing-discount.yaml (backend 4.1), optional.
type P = PricingDraft['schemas']
export type KioskProduct = S['KioskCatalogProductResponse'] & P['KioskCatalogProductPricing']
export type KioskOrderLine = S['KioskOrderItemResponse'] & P['OrderItemPricing']
export type KioskOrder = Omit<S['KioskOrderResponse'], 'items'> & P['OrderPricing'] & { items?: KioskOrderLine[] }
export type KioskPayment = S['KioskPaymentResponse']

export function configuredKioskKey(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env
  return (env?.VITE_KIOSK_API_KEY ?? '').trim()
}

export interface KioskApi {
  me: (signal?: AbortSignal) => Promise<ApiResult<KioskIdentity>>
  catalog: (signal?: AbortSignal) => Promise<ApiResult<KioskCatalog>>
  createOrder: (productId: string) => Promise<ApiResult<KioskOrder>>
  getOrder: (orderId: string, signal?: AbortSignal) => Promise<ApiResult<KioskOrder>>
  cancelOrder: (orderId: string) => Promise<ApiResult<KioskOrder>>
  createPayment: (orderId: string) => Promise<ApiResult<KioskPayment>>
}

export function createKioskApi(key: string): KioskApi {
  const call = <T>(method: string, path: string, options: RequestOptions = {}) =>
    requestWithMeta<T>(method, path, { ...options, auth: false, headers: { 'X-Kiosk-Key': key } })
  const id = encodeURIComponent
  return {
    me: signal => call('GET', '/kiosk/me', { signal }),
    catalog: signal => call('GET', '/kiosk/catalog', { signal }),
    // Exactly { productId }: never price, quantity or machine. Not retried automatically (the order may exist and hold a bowl).
    createOrder: productId => call('POST', '/kiosk/orders', { body: { productId } satisfies S['CreateOrderRequest'] }),
    getOrder: (orderId, signal) => call('GET', `/kiosk/orders/${id(orderId)}`, { signal, timeoutMs: 8_000 }),
    cancelOrder: orderId => call('POST', `/kiosk/orders/${id(orderId)}/cancel`),
    createPayment: orderId => call('POST', `/kiosk/orders/${id(orderId)}/payments`, { timeoutMs: 30_000 }),
  }
}
