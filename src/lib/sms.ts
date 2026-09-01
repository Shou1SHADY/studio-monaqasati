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

export async function sendSms({ to, body }: SendSmsInput): Promise<{ sent: boolean; error?: string }> {
  if (!isSmsConfigured()) {
    console.warn("Twilio credentials not configured — SMS skipped.")
    return { sent: false, error: "SMS_NOT_CONFIGURED" }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID!
  const authToken = process.env.TWILIO_AUTH_TOKEN!
  const fromPhone = process.env.TWILIO_PHONE_NUMBER!

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      },
      body: new URLSearchParams({ To: to, From: fromPhone, Body: body }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      console.error("Twilio API error:", res.status, data)
      return { sent: false, error: `TWILIO_${res.status}` }
    }

    return { sent: true }
  } catch (err) {
    console.error("Failed to reach Twilio:", err)
    return { sent: false, error: "SMS_NETWORK_ERROR" }
  }
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
