import { NextRequest, NextResponse } from "next/server"
import { adminCaller, adminError } from "@/lib/admin-caller-server"
import { assessPackageChange, contractorOff, readStoredModules } from "@/lib/procurement/package-change-server"
import { PROJECT_SCAN_CAP } from "@/lib/procurement/package-migration"

// Admin-only: «ما يتغيّر» for the package the admin has staged on a contractor — the transition rule's counts, read from the
// company's own records. Counts only; nothing is written. `off` is the staged list (absent = the stored one, no change).

export async function GET(req: NextRequest) {
  try {
    const caller = await adminCaller(req)
    if (caller instanceof NextResponse) return caller
    const orgId = req.nextUrl.searchParams.get("orgId")?.trim() || ""
    if (!orgId || orgId.includes("/")) return adminError("orgId is required", "INVALID_INPUT", 400)
    const owner = (await caller.db.collection("users").doc(orgId).get()).data()
    if (!owner || owner.role !== "Contractor") return adminError("Not a contractor company", "NOT_FOUND", 404)

    const stored = await readStoredModules(caller.db, orgId)
    const staged = req.nextUrl.searchParams.get("off")
    const next = staged === null ? stored.off : contractorOff(staged.split(",").map((x) => x.trim()).filter(Boolean))
    const { plan, warnings } = await assessPackageChange(caller.db, orgId, stored.off, next)
    return NextResponse.json({
      success: true,
      data: {
        from: plan.from,
        to: plan.to,
        off: next,
        changes: plan.changes.map((c) => ({ conn: c.conn, to: c.to, impact: c.impact })),
        hrDependent: plan.hrDependent,
        projectsCapped: plan.projectsCapped,
        scanCap: PROJECT_SCAN_CAP,
        warnings,
      },
    })
  } catch (err) {
    console.error("company-modules impact failed:", err)
    return adminError("Could not read the impact", "SERVER_ERROR", 500)
  }
}
