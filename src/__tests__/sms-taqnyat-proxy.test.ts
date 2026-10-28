/** @jest-environment node */
import { EventEmitter } from "node:events"

type Captured = { url: string; options: { method?: string; headers?: Record<string, string>; agent?: { proxy?: string } }; payload: string }
const captured: Captured[] = []
let answer: { status: number; body: string } | { error: Error } = { status: 201, body: "{}" }

jest.mock("https-proxy-agent", () => ({
  HttpsProxyAgent: jest.fn().mockImplementation((proxy: string) => ({ proxy })),
}))

jest.mock("node:https", () => ({
  request: jest.fn((url: string, options: Captured["options"], onResponse: (res: EventEmitter & { statusCode?: number; setEncoding: () => void }) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: (payload: string) => void; destroy: (e: Error) => void }
    req.destroy = (e: Error) => req.emit("error", e)
    req.end = (payload: string) => {
      captured.push({ url, options, payload })
      if ("error" in answer) {
        req.emit("error", answer.error)
        return
      }
      const res = Object.assign(new EventEmitter(), { statusCode: answer.status, setEncoding: () => {} })
      const { body } = answer
      onResponse(res)
      res.emit("data", body)
      res.emit("end")
    }
    return req
  }),
}))

import { isTaqnyatConfigured, sendSms } from "@/lib/sms"

const ENV_KEYS = ["TAQNYAT_BEARER_TOKEN", "TAQNYAT_SENDER", "TAQNYAT_PROXY_URL", "FIXIE_URL", "TAQNYAT_RELAY_URL", "TAQNYAT_RELAY_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] as const
const savedEnv: Record<string, string | undefined> = {}
const PROXY = "http://fixie:secret@ventoux.usefixie.com:80"
let fetchMock: jest.Mock

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  captured.length = 0
  answer = { status: 201, body: JSON.stringify({ statusCode: 201, rejected: "[]" }) }
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.TAQNYAT_BEARER_TOKEN = "b".repeat(32)
  process.env.TAQNYAT_SENDER = "MdmakTech"
  process.env.TAQNYAT_PROXY_URL = PROXY
  jest.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  jest.restoreAllMocks()
})

describe("sendSms through a static-IP proxy (Fixie)", () => {
  it("tunnels the Taqnyat call through the proxy, with the token as Taqnyat's header and not through fetch", async () => {
    expect(isTaqnyatConfigured()).toBe(true)
    expect(await sendSms({ to: "+966501234567", body: "رمزك 123456" })).toEqual({ sent: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(captured).toHaveLength(1)
    const [{ url, options, payload }] = captured
    expect(url).toBe("https://api.taqnyat.sa/v1/messages")
    expect(options.method).toBe("POST")
    expect(options.agent).toEqual({ proxy: PROXY })
    expect(options.headers?.Authorization).toBe("Bearer " + "b".repeat(32))
    expect(options.headers?.["Content-Length"]).toBe(String(Buffer.byteLength(payload)))
    expect(JSON.parse(payload)).toEqual({ recipients: ["966501234567"], body: "رمزك 123456", sender: "MdmakTech" })
  })

  it("reads Taqnyat's refusal through the proxy (e.g. the proxy's IP not yet allowed)", async () => {
    answer = { status: 400, body: JSON.stringify({ statusCode: 400, message: "IP not allowed" }) }
    expect(await sendSms({ to: "+966501234567", body: "x" })).toEqual({ sent: false, error: "TAQNYAT_400" })
  })

  it("a proxy that cannot be reached is a network error, and the proxy password is never logged", async () => {
    answer = { error: new Error("ECONNREFUSED") }
    expect(await sendSms({ to: "+966501234567", body: "x" })).toEqual({ sent: false, error: "SMS_NETWORK_ERROR" })
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain("secret")
  })

  it("uses FIXIE_URL, the variable Fixie's Vercel integration sets, when TAQNYAT_PROXY_URL is absent", async () => {
    delete process.env.TAQNYAT_PROXY_URL
    process.env.FIXIE_URL = PROXY
    expect(await sendSms({ to: "+966501234567", body: "x" })).toEqual({ sent: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(captured[0].options.agent).toEqual({ proxy: PROXY })
  })

  it("the relay wins when both are set", async () => {
    process.env.TAQNYAT_RELAY_URL = "https://sms.example.sa/relay/"
    process.env.TAQNYAT_RELAY_KEY = "k".repeat(64)
    fetchMock.mockResolvedValue({ status: 201, text: async () => JSON.stringify({ statusCode: 201, rejected: "[]" }) })
    expect(await sendSms({ to: "+966501234567", body: "x" })).toEqual({ sent: true })
    expect(captured).toHaveLength(0)
    expect(fetchMock.mock.calls[0][0]).toBe("https://sms.example.sa/relay/")
  })

  it("ignores a value that is not a proxy URL and calls Taqnyat directly", async () => {
    process.env.TAQNYAT_PROXY_URL = "ventoux.usefixie.com:80"
    fetchMock.mockResolvedValue({ status: 201, text: async () => JSON.stringify({ statusCode: 201, rejected: "[]" }) })
    expect(await sendSms({ to: "+966501234567", body: "x" })).toEqual({ sent: true })
    expect(captured).toHaveLength(0)
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.taqnyat.sa/v1/messages")
  })
})
