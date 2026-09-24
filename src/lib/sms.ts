// Server-only — SMS via the Twilio REST API.
// Never import this file in client components.

type SendSmsInput = {
  to: string
  body: string
}

// A secret that exists only so a build can mount it is not a gateway: UAT's
// TWILIO_ACCOUNT_SID was a 36-character placeholder, which passed the old
// "not the ACxxx example" test, so every code went to Twilio, failed, and the
// on-screen test code UAT relies on was never reached. Only the real shapes count.
const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/
const E164 = /^\+[1-9]\d{6,14}$/
// Saudi carriers take SMS only from a registered alphanumeric sender ID
// (1–11 letters/digits, at least one letter) — a US number is dropped — or
// through a Messaging Service holding that sender.
const ALPHA_SENDER = /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/
const MESSAGING_SERVICE_SID = /^MG[0-9a-fA-F]{32}$/

/** Where a message is sent from: a Messaging Service wins over a sender. */
function smsSender(): { MessagingServiceSid: string } | { From: string } | null {
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID || ""
  if (MESSAGING_SERVICE_SID.test(service)) return { MessagingServiceSid: service }
  const from = (process.env.TWILIO_PHONE_NUMBER || "").trim()
  if (E164.test(from) && !from.startsWith("+15551")) return { From: from }
  if (ALPHA_SENDER.test(from)) return { From: from }
  return null
}

export function isSmsConfigured(): boolean {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || ""
  const authToken = process.env.TWILIO_AUTH_TOKEN || ""
  return (
    ACCOUNT_SID.test(accountSid) &&
    !/^ACx+/i.test(accountSid) &&
    authToken.length >= 32 &&
    authToken !== "your_auth_token_here" &&
    smsSender() != null
  )
}

async function twilioSend(params: Record<string, string>): Promise<{ sent: boolean; error?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken = process.env.TWILIO_AUTH_TOKEN!
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      },
      body: new URLSearchParams(params),
    })

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { code?: number; message?: string }
      console.error("Twilio API error:", res.status, data)
      return { sent: false, error: `TWILIO_${data.code || res.status}` }
    }

    return { sent: true }
  } catch (err) {
    console.error("Failed to reach Twilio:", err)
    return { sent: false, error: "SMS_NETWORK_ERROR" }
  }
}

export async function sendSms({ to, body }: SendSmsInput): Promise<{ sent: boolean; error?: string }> {
  if (!isSmsConfigured()) {
    console.warn("Twilio credentials not configured — SMS skipped.")
    return { sent: false, error: "SMS_NOT_CONFIGURED" }
  }
  return twilioSend({ To: to, ...smsSender()!, Body: body })
}

// WhatsApp via Meta's Cloud API (graph.facebook.com) — direct, no Twilio.
// WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN come from the Meta
// developer app (WhatsApp product). Business-initiated messages outside a 24h
// session require an approved TEMPLATE: when WHATSAPP_TEMPLATE_NAME is set,
// sends use it with the body as {{1}}; otherwise a plain text message is
// attempted (works in dev with the test number / open sessions).
export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
}

export async function sendWhatsApp({ to, body }: SendSmsInput): Promise<{ sent: boolean; error?: string }> {
  if (!isWhatsAppConfigured()) return { sent: false, error: "WHATSAPP_NOT_CONFIGURED" }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN!
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG || "ar"
  const recipient = to.replace(/^whatsapp:/, "").replace(/^\+/, "")

  const payload = templateName
    ? {
        messaging_product: "whatsapp",
        to: recipient,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLang },
          components: [{ type: "body", parameters: [{ type: "text", text: body }] }],
        },
      }
    : { messaging_product: "whatsapp", to: recipient, type: "text", text: { body } }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string } }
      console.error("WhatsApp Cloud API error:", res.status, data.error?.code, data.error?.message)
      return { sent: false, error: `WHATSAPP_${data.error?.code || res.status}` }
    }
    return { sent: true }
  } catch (err) {
    console.error("Failed to reach WhatsApp Cloud API:", err)
    return { sent: false, error: "WHATSAPP_NETWORK_ERROR" }
  }
}

/**
 * Preferred delivery: WhatsApp first (near-universal in Saudi B2B, and not
 * subject to KSA's foreign-long-code SMS blocking), falling back to plain SMS
 * when WhatsApp isn't configured or the send fails.
 */
export async function sendDirectMessage({ to, body }: SendSmsInput): Promise<{ sent: boolean; channel?: "whatsapp" | "sms"; error?: string }> {
  if (isWhatsAppConfigured()) {
    const wa = await sendWhatsApp({ to, body })
    if (wa.sent) return { sent: true, channel: "whatsapp" }
  }
  const sms = await sendSms({ to, body })
  return sms.sent ? { sent: true, channel: "sms" } : { sent: false, error: sms.error }
}

/**
 * Best-effort E.164 normalization with Saudi Arabia as the default country.
 * Profile phones are stored in whatever shape the user typed (05xxxxxxxx,
 * 5xxxxxxxx, 9665xxxxxxxx, +9665xxxxxxxx, 00966...). Returns null when the
 * input can't be shaped into something Twilio would accept.
 */
export function normalizePhoneE164(raw: string | undefined | null): string | null {
  if (!raw) return null
  let digits = String(raw).replace(/[\s\-().]/g, "")
  if (!digits) return null

  if (digits.startsWith("00")) digits = "+" + digits.slice(2)
  if (digits.startsWith("+")) {
    const rest = digits.slice(1)
    return /^\d{8,15}$/.test(rest) ? "+" + rest : null
  }
  if (!/^\d+$/.test(digits)) return null

  if (digits.startsWith("966")) return digits.length >= 11 && digits.length <= 13 ? "+" + digits : null
  if (digits.startsWith("05") && digits.length === 10) return "+966" + digits.slice(1)
  if (digits.startsWith("5") && digits.length === 9) return "+966" + digits
  return null
}
