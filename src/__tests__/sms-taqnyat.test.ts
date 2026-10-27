import { canSendCodes, checkVerification, isSmsConfigured, isTaqnyatConfigured, isVerifyConfigured, sendDirectMessage, sendSms } from "@/lib/sms"

const ENV_KEYS = [
  "TAQNYAT_BEARER_TOKEN",
  "TAQNYAT_SENDER",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_VERIFY_SERVICE_SID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
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
  jest.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  jest.restoreAllMocks()
})

function configureTaqnyat() {
  process.env.TAQNYAT_BEARER_TOKEN = "b".repeat(32)
  process.env.TAQNYAT_SENDER = "MdmakTech"
}

function configureTwilioVerify() {
  process.env.TWILIO_ACCOUNT_SID = "AC" + "1".repeat(32)
  process.env.TWILIO_AUTH_TOKEN = "t".repeat(32)
  process.env.TWILIO_PHONE_NUMBER = "+17438373649"
  process.env.TWILIO_VERIFY_SERVICE_SID = "VA" + "2".repeat(32)
}

const reply = (status: number, data: Record<string, unknown>) => ({ ok: status >= 200 && status < 300, status, json: async () => data })

describe("Taqnyat configuration", () => {
  it("needs both the bearer token and an approved-shape sender name", () => {
    expect(isTaqnyatConfigured()).toBe(false)
    process.env.TAQNYAT_BEARER_TOKEN = "b".repeat(32)
    expect(isTaqnyatConfigured()).toBe(false)
    process.env.TAQNYAT_SENDER = "MdmakTech"
    expect(isTaqnyatConfigured()).toBe(true)
    expect(isSmsConfigured()).toBe(true)
    expect(canSendCodes()).toBe(true)
  })

  it("refuses a placeholder token or a sender that is not 1-11 letters/digits", () => {
    process.env.TAQNYAT_BEARER_TOKEN = "short"
    process.env.TAQNYAT_SENDER = "MdmakTech"
    expect(isTaqnyatConfigured()).toBe(false)
    process.env.TAQNYAT_BEARER_TOKEN = "b".repeat(32)
    process.env.TAQNYAT_SENDER = "Mdmak-Tech-Platform"
    expect(isTaqnyatConfigured()).toBe(false)
  })

  it("takes one-time codes off Twilio Verify so they go through the Saudi sender", () => {
    configureTwilioVerify()
    expect(isVerifyConfigured()).toBe(true)
    configureTaqnyat()
    expect(isVerifyConfigured()).toBe(false)
  })

  it("still checks a code Verify sent before Taqnyat was switched on", async () => {
    configureTwilioVerify()
    configureTaqnyat()
    fetchMock.mockResolvedValue(reply(200, { status: "approved" }))
    expect(await checkVerification("VE" + "3".repeat(32), "123456")).toBe("approved")
    expect(fetchMock.mock.calls[0][0]).toContain("verify.twilio.com")
  })
})

describe("sendSms through Taqnyat", () => {
  it("posts JSON with the bearer token, the number without +, the body and the sender", async () => {
    configureTaqnyat()
    configureTwilioVerify()
    fetchMock.mockResolvedValue(reply(201, { statusCode: 201, messageId: 1, accepted: "[966501234567,]", rejected: "[]" }))
    const result = await sendSms({ to: "+966501234567", body: "رمزك 123456" })
    expect(result).toEqual({ sent: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.taqnyat.sa/v1/messages")
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBe("Bearer " + "b".repeat(32))
    expect(JSON.parse(init.body)).toEqual({ recipients: ["966501234567"], body: "رمزك 123456", sender: "MdmakTech" })
  })

  it("reports Taqnyat's refusal (e.g. IP not allowed) as not sent, without falling back to Twilio", async () => {
    configureTaqnyat()
    configureTwilioVerify()
    fetchMock.mockResolvedValue(reply(400, { statusCode: 400, message: "Sending from this IP is not allowed" }))
    expect(await sendSms({ to: "+966501234567", body: "x" })).toEqual({ sent: false, error: "TAQNYAT_400" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("counts a rejected recipient as not sent", async () => {
    configureTaqnyat()
    fetchMock.mockResolvedValue(reply(201, { statusCode: 201, accepted: [], rejected: ["966501234567"] }))
    expect(await sendSms({ to: "+966501234567", body: "x" })).toEqual({ sent: false, error: "TAQNYAT_REJECTED" })
  })

  it("never logs the phone number or the message text", async () => {
    configureTaqnyat()
    fetchMock.mockResolvedValue(reply(400, { statusCode: 400, message: "Balance is zero" }))
    await sendSms({ to: "+966501234567", body: "رمزك 987654" })
    const logged = JSON.stringify((console.error as jest.Mock).mock.calls)
    expect(logged).not.toContain("501234567")
    expect(logged).not.toContain("987654")
  })

  it("is the SMS leg of sendDirectMessage when WhatsApp is off", async () => {
    configureTaqnyat()
    fetchMock.mockResolvedValue(reply(201, { statusCode: 201, rejected: "[]" }))
    expect(await sendDirectMessage({ to: "+966501234567", body: "x" })).toEqual({ sent: true, channel: "sms" })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.taqnyat.sa/v1/messages")
  })

  it("leaves Twilio as it was when Taqnyat is not set up", async () => {
    configureTwilioVerify()
    fetchMock.mockResolvedValue(reply(201, {}))
    expect(await sendSms({ to: "+966501234567", body: "x" })).toEqual({ sent: true })
    expect(fetchMock.mock.calls[0][0]).toContain("api.twilio.com")
  })
})
