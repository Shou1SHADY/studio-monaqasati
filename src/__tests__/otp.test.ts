/**
 * One-time codes for signing a receipt. The rules that matter are the ones a
 * browser must not be able to get around: the code is never derivable from
 * what is stored, a used or over-guessed challenge refuses even the right code,
 * and a challenge issued for one thing cannot confirm another.
 */

import {
  OTP_DIGITS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_MS,
  OTP_TTL_MS,
  generateCode,
  hashCode,
  judge,
  maskPhone,
  mayResend,
  type OtpChallenge,
} from "@/lib/otp"

const NOW = 1_800_000_000_000
const ID = "ch1"
const SUBJECT = { purpose: "receipt_sign" as const, subjectId: "link1" }

const challenge = (over: Partial<OtpChallenge> = {}): OtpChallenge => ({
  purpose: "receipt_sign",
  subjectId: "link1",
  phone: "+966501234567",
  codeHash: hashCode(ID, "123456"),
  createdAt: NOW,
  expiresAt: NOW + OTP_TTL_MS,
  attempts: 0,
  consumedAt: null,
  ...over,
})

describe("the code itself", () => {
  it("is always six digits, leading zeros kept", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(new RegExp(`^\\d{${OTP_DIGITS}}$`))
  })

  it("is stored only as a hash bound to its challenge", () => {
    expect(hashCode(ID, "123456")).not.toContain("123456")
    // The same digits under another challenge hash differently, so a stored
    // hash cannot be replayed against a different receipt.
    expect(hashCode("ch2", "123456")).not.toBe(hashCode(ID, "123456"))
  })
})

describe("judging a guess", () => {
  it("accepts the right code in time", () => {
    expect(judge(challenge(), SUBJECT, ID, "123456", NOW + 1000)).toBe("ok")
  })

  it("refuses a wrong code, a malformed one, and a late one", () => {
    expect(judge(challenge(), SUBJECT, ID, "654321", NOW)).toBe("wrong")
    expect(judge(challenge(), SUBJECT, ID, "12345", NOW)).toBe("wrong")
    expect(judge(challenge(), SUBJECT, ID, "12345a", NOW)).toBe("wrong")
    expect(judge(challenge(), SUBJECT, ID, "123456", NOW + OTP_TTL_MS + 1)).toBe("expired")
  })

  it("refuses even the right code once used, or once guessed at too often", () => {
    expect(judge(challenge({ consumedAt: NOW }), SUBJECT, ID, "123456", NOW)).toBe("consumed")
    expect(judge(challenge({ attempts: OTP_MAX_ATTEMPTS }), SUBJECT, ID, "123456", NOW)).toBe("exhausted")
  })

  it("never confirms something it was not issued for", () => {
    expect(judge(challenge(), { ...SUBJECT, subjectId: "link2" }, ID, "123456", NOW)).toBe("mismatch")
    expect(judge(null, SUBJECT, ID, "123456", NOW)).toBe("missing")
  })

  it("checks a code against its own challenge id", () => {
    expect(judge(challenge(), SUBJECT, "ch2", "123456", NOW)).toBe("wrong")
  })
})

describe("a challenge whose code Twilio Verify made", () => {
  const remote = (over: Partial<OtpChallenge> = {}) => challenge({ codeHash: "", verificationSid: "VE" + "b".repeat(32), ...over })

  it("is handed to Twilio only after our own rules pass", () => {
    expect(judge(remote(), SUBJECT, ID, "123456", NOW)).toBe("remote")
    expect(judge(remote({ consumedAt: NOW }), SUBJECT, ID, "123456", NOW)).toBe("consumed")
    expect(judge(remote({ attempts: OTP_MAX_ATTEMPTS }), SUBJECT, ID, "123456", NOW)).toBe("exhausted")
    expect(judge(remote(), SUBJECT, ID, "123456", NOW + OTP_TTL_MS + 1)).toBe("expired")
    expect(judge(remote(), { purpose: "receipt_sign", subjectId: "other" }, ID, "123456", NOW)).toBe("mismatch")
    expect(judge(remote(), SUBJECT, ID, "12ab56", NOW)).toBe("wrong")
  })

  it("is never approved by an empty stored hash", () => {
    expect(judge(remote({ verificationSid: null }), SUBJECT, ID, "123456", NOW)).toBe("wrong")
  })
})

describe("resending", () => {
  it("allows the first code, then one a minute", () => {
    expect(mayResend(null, NOW)).toBe(true)
    expect(mayResend(NOW, NOW + OTP_RESEND_MS - 1)).toBe(false)
    expect(mayResend(NOW, NOW + OTP_RESEND_MS)).toBe(true)
  })
})

it("shows only the last four digits of the number", () => {
  expect(maskPhone("+966501234567")).toBe("•••• 4567")
})
