import { sendDirectMessage, sendWhatsApp, isWhatsAppConfigured } from "@/lib/sms"

const ENV_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
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
