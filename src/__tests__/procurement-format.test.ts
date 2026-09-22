/**
 * Procurement PRD 3.0 §15.1 — document numbers are stored in Latin and shown
 * with the Arabic prefix in Arabic; the digits and the slash never change.
 */

import { displayAgreementNumber, displayPoNumber, displayReceiptNumber, PROC_DOC_PREFIXES } from "@/lib/procurement/format"
import { displayDocNumber } from "@/lib/sales-numbering"

describe("Procurement document numbers", () => {
  it("PO → ط.ش, GR → ا.س and AG → اتف in Arabic, untouched in English; Sales' prefixes still work", () => {
    expect(displayPoNumber("PO-2026/014", "ar")).toBe("ط.ش-2026/014")
    expect(displayReceiptNumber("GR-2026/031", "ar")).toBe("ا.س-2026/031")
    expect(displayPoNumber("PO-2026/014", "en")).toBe("PO-2026/014")
    expect(displayPoNumber(null, "ar")).toBe("")
    expect(displayDocNumber("QT-2026/070", "ar")).toBe("ع.س-2026/070")
    expect(displayAgreementNumber("AG-2026/003", "ar")).toBe("اتف-2026/003")
    expect(displayAgreementNumber("AG-2026/003", "en")).toBe("AG-2026/003")
    expect(PROC_DOC_PREFIXES).toEqual({ PO: { latin: "PO", arabic: "ط.ش" }, GR: { latin: "GR", arabic: "ا.س" }, AG: { latin: "AG", arabic: "اتف" } })
  })
})
