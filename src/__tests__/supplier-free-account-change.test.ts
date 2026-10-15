/**
 * Supplier 1.0 — ACC-05: the sign-in mobile and the commercial register are never edited inline; each changes under
 * Security with a code (a new mobile by a code sent TO it, a register by a code to the sign-in mobile).
 */

import fs from "fs"
import path from "path"
import { accountChangeSchema, normalizeCr, phoneChangeRefusal } from "@/lib/supplier-free/phone-auth"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

describe("changing the sign-in mobile or the register", () => {
  it("refuses the same mobile and one another account holds, before the code is spent", () => {
    expect(phoneChangeRefusal("u1", "+966500000001", "+966500000001", [])).toBe("SAME_PHONE")
    expect(phoneChangeRefusal("u1", "+966500000001", "+966500000002", ["u2"])).toBe("PHONE_TAKEN")
    expect(phoneChangeRefusal("u1", "+966500000001", "+966500000002", ["u1"])).toBeNull()
  })
  it("a register is ten digits, in either numeral set", () => {
    expect(normalizeCr("1010 123456")).toBe("1010123456")
    expect(normalizeCr("١٠١٠١٢٣٤٥٦")).toBe("1010123456")
    expect(normalizeCr("12345")).toBeNull()
  })
  it("each change names its kind and carries a code", () => {
    expect(accountChangeSchema.safeParse({ kind: "phone", challengeId: "abcdefgh", code: "123456", phone: "0512345678" }).success).toBe(true)
    expect(accountChangeSchema.safeParse({ kind: "cr", challengeId: "abcdefgh", code: "123456", crNumber: "1010123456" }).success).toBe(true)
    expect(accountChangeSchema.safeParse({ kind: "cr", challengeId: "abcdefgh", crNumber: "1010123456" }).success).toBe(false)
  })
  it("the Security tab offers both changes", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/supplier-free/FreeAccount.tsx"), "utf8")
    expect(src).toContain('"/api/supplier-free/phone/change"')
    expect(src).toContain('setChange("phone")')
    expect(src).toContain('setChange("cr")')
  })
})

describe("the change's words exist in both languages", () => {
  const A = (ar as unknown as { SupplierFree: Record<string, string> }).SupplierFree
  const E = (en as unknown as { SupplierFree: Record<string, string> }).SupplierFree
  it.each(["chMob", "chMobX", "chNewMob", "chCr", "chCrX", "chNewCr", "chConfirm", "tMobChanged", "tCrChanged", "phErrTaken", "phErrSame", "phErrCr"])("%s", (k) => {
    expect(A[k]).toBeTruthy()
    expect(E[k]).toBeTruthy()
  })
})
