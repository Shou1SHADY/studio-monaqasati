/**
 * @jest-environment node
 *
 * A receipt code sent by Twilio Verify: Twilio says whether the digits match,
 * but a used, over-guessed or expired challenge is refused before Twilio is
 * asked, a right answer is consumed once, and a Twilio outage never burns a guess.
 */

import type { Firestore } from "firebase-admin/firestore"

let remoteAnswer: "approved" | "wrong" | "expired" | "error" = "approved"
const asked: string[] = []
jest.mock("@/lib/sms", () => ({
  checkVerification: async (sid: string) => {
    asked.push(sid)
    return remoteAnswer
  },
}))

import { OTP_MAX_ATTEMPTS, OTP_TTL_MS, verifyOtp, type OtpChallenge } from "@/lib/otp"

const NOW = 1_800_000_000_000
const SID = "VE" + "e".repeat(32)
const SUBJECT = { purpose: "receipt_sign" as const, subjectId: "link1" }
const docs = new Map<string, OtpChallenge>()

const db = {
  collection: () => ({ doc: (id: string) => ({ id }) }),
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
    fn({
      get: async (ref: { id: string }) => ({ exists: docs.has(ref.id), data: () => docs.get(ref.id) }),
      update: (ref: { id: string }, patch: Partial<OtpChallenge>) => void docs.set(ref.id, { ...(docs.get(ref.id) as OtpChallenge), ...patch }),
    }),
} as unknown as Firestore

const seed = (over: Partial<OtpChallenge> = {}) =>
  docs.set("ch1", {
    purpose: "receipt_sign",
    subjectId: "link1",
    phone: "+966501234567",
    codeHash: "",
    verificationSid: SID,
    createdAt: NOW,
    expiresAt: NOW + OTP_TTL_MS,
    attempts: 0,
    consumedAt: null,
    ...over,
  })

beforeEach(() => {
  docs.clear()
  asked.length = 0
  remoteAnswer = "approved"
})

test("Twilio's approval signs once, then the same code is refused", async () => {
  seed()
  await expect(verifyOtp(db, "ch1", SUBJECT, "123456", NOW)).resolves.toBe("ok")
  expect(asked).toEqual([SID])
  await expect(verifyOtp(db, "ch1", SUBJECT, "123456", NOW)).resolves.toBe("consumed")
  expect(asked).toHaveLength(1)
})

test("a wrong guess counts against the five", async () => {
  seed()
  remoteAnswer = "wrong"
  await expect(verifyOtp(db, "ch1", SUBJECT, "000000", NOW)).resolves.toBe("wrong")
  expect(docs.get("ch1")?.attempts).toBe(1)
})

test("an exhausted or expired challenge is refused without asking Twilio", async () => {
  seed({ attempts: OTP_MAX_ATTEMPTS })
  await expect(verifyOtp(db, "ch1", SUBJECT, "123456", NOW)).resolves.toBe("exhausted")
  seed()
  await expect(verifyOtp(db, "ch1", SUBJECT, "123456", NOW + OTP_TTL_MS + 1)).resolves.toBe("expired")
  expect(asked).toHaveLength(0)
})

test("a Twilio outage answers 'unavailable' and costs no guess", async () => {
  seed()
  remoteAnswer = "error"
  await expect(verifyOtp(db, "ch1", SUBJECT, "123456", NOW)).resolves.toBe("unavailable")
  expect(docs.get("ch1")?.attempts).toBe(0)
  expect(docs.get("ch1")?.consumedAt).toBeNull()
})
