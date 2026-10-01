/**
 * Inventory's reason on a request line is a CODE (`whyK`); the sentence stored
 * beside it is in the keeper's language. The project reads the code in its own
 * language (NFR-02) and falls back to the stored words only when there is no
 * code it knows.
 */

import fs from "fs"
import path from "path"
import { invWhyText } from "@/lib/pm/supply"

const en: Record<string, string> = { linked: "Committed to another project", none: "No stock in the main stores", dir: "Direct-supply material — not stocked" }
const ofCode = (k: string) => en[k] ?? null

describe("Inventory's reason", () => {
  it("is rendered from its code in the reader's language, not from the keeper's sentence", () => {
    expect(invWhyText({ whyK: "none", why: "لا رصيد في المستودعات" }, ofCode)).toBe("No stock in the main stores")
    expect(invWhyText({ whyK: "linked", why: "مرتبطة بمشروع أو غرض آخر" }, ofCode)).toBe("Committed to another project")
  })

  it("falls back to the stored words for a code it does not know, or none", () => {
    expect(invWhyText({ whyK: "oth", why: "تحت الجرد" }, ofCode)).toBe("تحت الجرد")
    expect(invWhyText({ whyK: null, why: "تحت الجرد" }, ofCode)).toBe("تحت الجرد")
    expect(invWhyText({ why: null }, ofCode)).toBeNull()
    expect(invWhyText(null, ofCode)).toBeNull()
  })

  it("the request drawer reads it that way, from Inventory's own messages", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "components", "pm", "SupplyRequestsPanel.tsx"), "utf8")
    expect(src).toContain('useTranslations("Portal.InvPm")')
    expect(src).toContain("invWhyText(l.inv")
    expect(src).not.toMatch(/why: l\.inv\.why \?\?/)
  })
})
