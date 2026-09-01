// Server-only — SMS via the Twilio REST API.
// Never import this file in client components.

type SendSmsInput = {
  to: string
  body: string
}

export function isSmsConfigured(): boolean {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromPhone = process.env.TWILIO_PHONE_NUMBER
  return Boolean(
    accountSid &&
      authToken &&
      fromPhone &&
      !accountSid.startsWith("ACxxx") &&
      authToken !== "your_auth_token_here" &&
      !fromPhone.startsWith("+15551")
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
  return twilioSend({ To: to, From: process.env.TWILIO_PHONE_NUMBER!, Body: body })
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
