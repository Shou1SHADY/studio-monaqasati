import { checkVerification, sendDirectMessage, sendSms, sendWhatsApp, isSmsConfigured, isVerifyConfigured, isWhatsAppConfigured, startVerification } from "@/lib/sms"

const ENV_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_VERIFY_SERVICE_SID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_TEMPLATE_NAME",
  "WHATSAPP_TEMPLATE_LANG",
] as const

const savedEnv: Record<string, string | undefined> = {}
let fetchMock: jest.Mock

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

function configureTwilio() {
  process.env.TWILIO_ACCOUNT_SID = "AC" + "1".repeat(32)
  process.env.TWILIO_AUTH_TOKEN = "t".repeat(32)
  process.env.TWILIO_PHONE_NUMBER = "+17438373649"
}

function configureWhatsApp() {
  process.env.WHATSAPP_ACCESS_TOKEN = "EAAG" + "x".repeat(40)
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789012345"
}

const okResponse = { ok: true, json: async () => ({}) }
const failResponse = { ok: false, status: 400, json: async () => ({ error: { code: 131047, message: "re-engagement" } }) }

describe("isWhatsAppConfigured", () => {
  it("requires both token and phone number id", () => {
    expect(isWhatsAppConfigured()).toBe(false)
    process.env.WHATSAPP_ACCESS_TOKEN = "x"
    expect(isWhatsAppConfigured()).toBe(false)
    process.env.WHATSAPP_PHONE_NUMBER_ID = "y"
    expect(isWhatsAppConfigured()).toBe(true)
  })
})

describe("sendWhatsApp", () => {
  it("sends a text message to the Graph API without a template", async () => {
    configureWhatsApp()
    fetchMock.mockResolvedValue(okResponse)
    const result = await sendWhatsApp({ to: "+966501234567", body: "hello" })
    expect(result.sent).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain("graph.facebook.com")
    expect(url).toContain("123456789012345/messages")
    const payload = JSON.parse(init.body)
    expect(payload.type).toBe("text")
    expect(payload.to).toBe("966501234567")
    expect(payload.text.body).toBe("hello")
  })

  it("sends a template message when WHATSAPP_TEMPLATE_NAME is set", async () => {
    configureWhatsApp()
    process.env.WHATSAPP_TEMPLATE_NAME = "rfq_published"
    process.env.WHATSAPP_TEMPLATE_LANG = "ar"
    fetchMock.mockResolvedValue(okResponse)
    await sendWhatsApp({ to: "whatsapp:+966501234567", body: "content" })
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(payload.type).toBe("template")
    expect(payload.template.name).toBe("rfq_published")
    expect(payload.template.language.code).toBe("ar")
    expect(payload.template.components[0].parameters[0].text).toBe("content")
  })

  it("reports the Graph error code on failure", async () => {
    configureWhatsApp()
    fetchMock.mockResolvedValue(failResponse)
    const result = await sendWhatsApp({ to: "+966501234567", body: "x" })
    expect(result).toEqual({ sent: false, error: "WHATSAPP_131047" })
  })
})

describe("sendDirectMessage", () => {
  it("prefers WhatsApp when configured", async () => {
    configureWhatsApp()
    configureTwilio()
    fetchMock.mockResolvedValue(okResponse)
    const result = await sendDirectMessage({ to: "+966501234567", body: "x" })
    expect(result).toEqual({ sent: true, channel: "whatsapp" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain("graph.facebook.com")
  })

  it("falls back to SMS when the WhatsApp send fails", async () => {
    configureWhatsApp()
    configureTwilio()
    fetchMock.mockResolvedValueOnce(failResponse).mockResolvedValueOnce(okResponse)
    const result = await sendDirectMessage({ to: "+201002500663", body: "x" })
    expect(result).toEqual({ sent: true, channel: "sms" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain("api.twilio.com")
  })

  it("uses SMS directly when WhatsApp is not configured", async () => {
    configureTwilio()
    fetchMock.mockResolvedValue(okResponse)
    const result = await sendDirectMessage({ to: "+201002500663", body: "x" })
    expect(result).toEqual({ sent: true, channel: "sms" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain("api.twilio.com")
  })

  it("fails cleanly when neither channel is configured", async () => {
    const result = await sendDirectMessage({ to: "+201002500663", body: "x" })
    expect(result.sent).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("isSmsConfigured — only real credentials count as a gateway", () => {
  test("well-formed credentials are configured", () => {
    configureTwilio()
    expect(isSmsConfigured()).toBe(true)
  })

  test("UAT's placeholder SID is not — so the on-screen test code is used instead of a doomed send", () => {
    configureTwilio()
    process.env.TWILIO_ACCOUNT_SID = "TWILIO_ACCOUNT_SID_PLACEHOLDER_VALUE"
    expect(isSmsConfigured()).toBe(false)
  })

  test("the documented example SID is not", () => {
    configureTwilio()
    process.env.TWILIO_ACCOUNT_SID = "AC" + "x".repeat(32)
    expect(isSmsConfigured()).toBe(false)
  })

  test("a sender that is neither an E.164 number nor a sender ID is not", () => {
    configureTwilio()
    process.env.TWILIO_PHONE_NUMBER = "twilio_phone_placeholder"
    expect(isSmsConfigured()).toBe(false)
    process.env.TWILIO_PHONE_NUMBER = "+123"
    expect(isSmsConfigured()).toBe(false)
  })

  test("a registered alphanumeric sender ID is configured and sends as From — Saudi carriers drop US numbers", async () => {
    configureTwilio()
    process.env.TWILIO_PHONE_NUMBER = "MDMAK"
    expect(isSmsConfigured()).toBe(true)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    await sendSms({ to: "+966500000000", body: "x" })
    const sent = new URLSearchParams(String(fetchMock.mock.calls[0][1].body))
    expect(sent.get("From")).toBe("MDMAK")
  })

  test("a Messaging Service wins over the sender and needs no From", async () => {
    configureTwilio()
    process.env.TWILIO_PHONE_NUMBER = ""
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG" + "a".repeat(32)
    try {
      expect(isSmsConfigured()).toBe(true)
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      await sendSms({ to: "+966500000000", body: "x" })
      const sent = new URLSearchParams(String(fetchMock.mock.calls[0][1].body))
      expect(sent.get("MessagingServiceSid")).toBe("MG" + "a".repeat(32))
      expect(sent.get("From")).toBeNull()
    } finally {
      delete process.env.TWILIO_MESSAGING_SERVICE_SID
    }
  })

  test("a short or example auth token is not", () => {
    configureTwilio()
    process.env.TWILIO_AUTH_TOKEN = "your_auth_token_here"
    expect(isSmsConfigured()).toBe(false)
  })

  test("nothing set is not", () => {
    expect(isSmsConfigured()).toBe(false)
  })
})

describe("Twilio Verify — one-time codes without a sender of our own", () => {
  const SERVICE = "VA" + "c".repeat(32)
  const VE = "VE" + "d".repeat(32)

  test("needs real credentials and a VA service id — no sender required", () => {
    configureTwilio()
    process.env.TWILIO_PHONE_NUMBER = ""
    expect(isVerifyConfigured()).toBe(false)
    process.env.TWILIO_VERIFY_SERVICE_SID = SERVICE
    expect(isVerifyConfigured()).toBe(true)
    expect(isSmsConfigured()).toBe(false)
    process.env.TWILIO_VERIFY_SERVICE_SID = "placeholder"
    expect(isVerifyConfigured()).toBe(false)
  })

  test("starts a verification by SMS in the reader's language and keeps its id", async () => {
    configureTwilio()
    process.env.TWILIO_VERIFY_SERVICE_SID = SERVICE
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ sid: VE, status: "pending" }) })
    await expect(startVerification("+966500000000", "ar")).resolves.toEqual({ sent: true, verificationSid: VE })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://verify.twilio.com/v2/Services/${SERVICE}/Verifications`)
    const sent = new URLSearchParams(String(init.body))
    expect(sent.get("To")).toBe("+966500000000")
    expect(sent.get("Channel")).toBe("sms")
    expect(sent.get("Locale")).toBe("ar")
  })

  test("checks a guess against that verification and reads Twilio's answer", async () => {
    configureTwilio()
    process.env.TWILIO_VERIFY_SERVICE_SID = SERVICE
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "approved" }) })
    await expect(checkVerification(VE, "123456")).resolves.toBe("approved")
    const sent = new URLSearchParams(String(fetchMock.mock.calls[0][1].body))
    expect(fetchMock.mock.calls[0][0]).toBe(`https://verify.twilio.com/v2/Services/${SERVICE}/VerificationCheck`)
    expect(sent.get("VerificationSid")).toBe(VE)
    expect(sent.get("Code")).toBe("123456")

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "pending" }) })
    await expect(checkVerification(VE, "000000")).resolves.toBe("wrong")
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ code: 20404 }) })
    await expect(checkVerification(VE, "123456")).resolves.toBe("expired")
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    await expect(checkVerification(VE, "123456")).resolves.toBe("error")
  })
})
