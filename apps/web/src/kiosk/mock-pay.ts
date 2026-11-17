// Demo helper kept from the purchase-dispense work: when the local backend runs PAYMENT_PROVIDER=MOCK (QR text
// "MOCK-QR|<reference>|<amount>"), it posts a signed MOCK webhook and asks the hardware bridge to move the servo.
// Only reachable from a MOCK-QR code; real payOS QR codes never show the button.
// The webhook secret is never in the source: it comes from VITE_DEV_MOCK_WEBHOOK_SECRET (apps/web/.env.local, the
// same value as the local backend's MOCK webhook secret), and only in `npm run dev`. Without it there is no button.

/** The MOCK webhook secret: only in a dev server (`DEV`), and only when VITE_DEV_MOCK_WEBHOOK_SECRET is set. */
export function mockWebhookSecret(env: { DEV?: boolean; VITE_DEV_MOCK_WEBHOOK_SECRET?: string }): string {
  return env.DEV ? (env.VITE_DEV_MOCK_WEBHOOK_SECRET ?? '').trim() : ''
}

export async function simulateMockPayment(qrCode: string, orderCode?: string, column: number = 1) {
  // `import.meta.env.DEV` is false in a production build, so the minifier drops the variable and its value.
  const secret = import.meta.env.DEV ? mockWebhookSecret({ DEV: true, VITE_DEV_MOCK_WEBHOOK_SECRET: import.meta.env.VITE_DEV_MOCK_WEBHOOK_SECRET }) : ''
  if (!secret) return false
  const parts = qrCode.split('|')
  if (parts.length < 3) return false
  const paymentReference = parts[1]
  const amount = Number(parts[2])
  const transactionId = 'MOCK-TXN-' + Math.random().toString(36).substring(2, 9).toUpperCase()
  const rawBody = `{"paymentReference":"${paymentReference}","transactionId":"${transactionId}","amount":${amount},"status":"SUCCESS"}`

  const enc = new TextEncoder()
  const key = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBuffer = await window.crypto.subtle.sign('HMAC', key, enc.encode(rawBody))
  const signature = Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  try {
    await fetch('/api/v1/webhooks/payments/mock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mock-Signature': signature
      },
      body: rawBody
    })
  } catch (e) {
    console.error('Webhook error:', e)
  }

  // Trigger hardware bridge on port 5001 to move ESP32 servos over COM4
  try {
    const cmdId = orderCode || ('CMD-' + Math.random().toString(36).substring(2, 8).toUpperCase())
    await fetch('/bridge/dispense', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: cmdId, column })
    }).catch(() => fetch('http://127.0.0.1:5001/dispense', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId: cmdId, column })
    }))
  } catch (err) {
    console.warn('Hardware bridge not reachable:', err)
  }
}

