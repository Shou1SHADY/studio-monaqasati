/**
 * Component switches (7 Oct 2026): which of a company's optional components are off, what that does to
 * its menu and launcher, which addresses it blocks, and what the admin may write.
 */

jest.mock("firebase/firestore", () => jest.requireActual<typeof import("@/test-utils/fake-firestore")>("@/test-utils/fake-firestore").firestoreModule)

import { fakeFirestore, readDoc, resetFakeDb } from "@/test-utils/fake-firestore"
import type { Firestore } from "firebase/firestore"
import { applyModuleSwitches, belongsToOptionalModule, isOptionalModule, offModuleOwning, offSet, optionalFor } from "@/lib/company-modules"
import { setCompanyModules } from "@/lib/company-modules-writes"
import { CONTRACTOR_COMPONENTS, SUPPLIER_COMPONENTS, visibleComponents } from "@/lib/portal-components"

const ids = (list: { id: string }[]) => list.map((c) => c.id)

describe("what is switched off", () => {
  it("only three components can be switched, and a supplier has two of them", () => {
    expect(optionalFor("contractor")).toEqual(["project-management", "hr", "manufacturing"])
    expect(optionalFor("supplier")).toEqual(["hr", "manufacturing"])
    expect(isOptionalModule("hr")).toBe(true)
    expect(isOptionalModule("payments")).toBe(false)
  })

  it("reads the stored list, ignoring anything that is not one of the portal's switches", () => {
    expect([...offSet({ off: ["hr", "payments", 7, "manufacturing", "hr"] }, "contractor")].sort()).toEqual(["hr", "manufacturing"])
    expect([...offSet({ off: ["project-management", "hr"] }, "supplier")]).toEqual(["hr"])
  })

  it("is empty for a company nobody switched anything for", () => {
    expect(offSet(null, "contractor").size).toBe(0)
    expect(offSet({}, "contractor").size).toBe(0)
    expect(offSet({ off: "hr" }, "contractor").size).toBe(0)
    expect(offSet({ off: ["hr"] }, null).size).toBe(0)
  })
})

describe("the menu and launcher of a company", () => {
  it("is the whole registry when nothing is off", () => {
    expect(applyModuleSwitches(CONTRACTOR_COMPONENTS, new Set(), "contractor")).toBe(CONTRACTOR_COMPONENTS)
  })

  it("loses HR and Manufacturing entirely when they are off, and nothing else", () => {
    const own = applyModuleSwitches(CONTRACTOR_COMPONENTS, new Set(["hr", "manufacturing"]), "contractor")
    expect(ids(own)).not.toContain("hr")
    expect(ids(own)).not.toContain("manufacturing")
    expect(ids(own)).toEqual(expect.arrayContaining(["procurement", "warehouses", "payments", "crm", "sales", "users", "project-management"]))
    expect(own).toHaveLength(CONTRACTOR_COMPONENTS.length - 2)
  })

  it("keeps the portal's dashboard when Project Management is off, but not its projects, and it stops being a tile", () => {
    const own = applyModuleSwitches(CONTRACTOR_COMPONENTS, new Set(["project-management"]), "contractor")
    const pm = own.find((c) => c.id === "project-management")!
    expect(pm.launcher).toBe(false)
    expect(pm.homeHref).toBe("/contractor")
    const hrefs = pm.sections.flatMap((s) => s.items.map((i) => i.href))
    expect(hrefs).toEqual(["/contractor"])
  })

  it("leaves a launcher-less module out of what a member can open", () => {
    const own = applyModuleSwitches(CONTRACTOR_COMPONENTS, new Set(["project-management"]), "contractor")
    expect(ids(visibleComponents(own, () => true))).not.toContain("project-management")
    expect(ids(visibleComponents(CONTRACTOR_COMPONENTS, () => true))).toContain("project-management")
  })

  it("never touches a supplier's dashboard, which carries the project-management id", () => {
    const own = applyModuleSwitches(SUPPLIER_COMPONENTS, new Set(["project-management", "hr"]), "supplier")
    expect(ids(own)).toContain("project-management")
    expect(ids(own)).not.toContain("hr")
    expect(own.find((c) => c.id === "project-management")?.launcher).toBeUndefined()
  })
})

describe("what an address belongs to", () => {
  const off = (...x: string[]) => new Set(x)

  it("blocks the pages of a switched-off module", () => {
    expect(offModuleOwning("/contractor/hr", CONTRACTOR_COMPONENTS, off("hr"), "contractor")).toBe("hr")
    expect(offModuleOwning("/contractor/manufacturing", CONTRACTOR_COMPONENTS, off("manufacturing"), "contractor")).toBe("manufacturing")
    expect(offModuleOwning("/supplier/hr/people", SUPPLIER_COMPONENTS, off("hr"), "supplier")).toBe("hr")
  })

  it("blocks the projects but never the portal's home when Project Management is off", () => {
    expect(offModuleOwning("/contractor/projects", CONTRACTOR_COMPONENTS, off("project-management"), "contractor")).toBe("project-management")
    expect(offModuleOwning("/contractor/projects/abc", CONTRACTOR_COMPONENTS, off("project-management"), "contractor")).toBe("project-management")
    expect(offModuleOwning("/contractor/projects/inbox", CONTRACTOR_COMPONENTS, off("project-management"), "contractor")).toBe("project-management")
    expect(offModuleOwning("/contractor", CONTRACTOR_COMPONENTS, off("project-management"), "contractor")).toBeNull()
  })

  it("lets everything else through, and everything when nothing is off", () => {
    for (const path of ["/contractor/rfqs", "/contractor/warehouses", "/contractor/accounting", "/contractor/crm", "/contractor/profile", "/contractor/activities", "/contractor/documents", "/contractor/notifications"]) {
      expect(offModuleOwning(path, CONTRACTOR_COMPONENTS, off("hr", "manufacturing", "project-management"), "contractor")).toBeNull()
    }
    expect(offModuleOwning("/contractor/hr", CONTRACTOR_COMPONENTS, off(), "contractor")).toBeNull()
  })

  it("does not take a supplier's dashboard for a module, and ignores a switch the portal does not have", () => {
    expect(offModuleOwning("/supplier", SUPPLIER_COMPONENTS, off("project-management"), "supplier")).toBeNull()
    expect(offModuleOwning("/supplier/orders", SUPPLIER_COMPONENTS, off("project-management"), "supplier")).toBeNull()
  })

  it("knows which addresses wait while the switches load", () => {
    expect(belongsToOptionalModule("/contractor/hr", CONTRACTOR_COMPONENTS, "contractor")).toBe(true)
    expect(belongsToOptionalModule("/contractor/projects/x", CONTRACTOR_COMPONENTS, "contractor")).toBe(true)
    expect(belongsToOptionalModule("/contractor", CONTRACTOR_COMPONENTS, "contractor")).toBe(false)
    expect(belongsToOptionalModule("/contractor/rfqs", CONTRACTOR_COMPONENTS, "contractor")).toBe(false)
    expect(belongsToOptionalModule("/supplier/orders", SUPPLIER_COMPONENTS, "supplier")).toBe(false)
  })
})

describe("the admin's write", () => {
  const db = fakeFirestore as unknown as Firestore
  beforeEach(() => resetFakeDb())

  it("stores the company's own switches, deduplicated and only the three that exist, in the admin's name", async () => {
    await setCompanyModules(db, "org1", ["hr", "hr", "manufacturing", "payments" as never], { uid: "adm", name: "Admin" })
    expect(readDoc("companyModules/org1")).toMatchObject({ organizationId: "org1", off: ["hr", "manufacturing"], updatedById: "adm", updatedByName: "Admin" })
  })

  it("an empty list switches everything back on", async () => {
    await setCompanyModules(db, "org1", ["hr"], { uid: "adm", name: "A" })
    await setCompanyModules(db, "org1", [], { uid: "adm", name: "A" })
    expect(readDoc<{ off: string[] }>("companyModules/org1")?.off).toEqual([])
  })
})
