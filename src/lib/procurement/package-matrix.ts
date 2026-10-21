// The eight cases as the team's test matrix reads them: for each package, where requests come from, what is asked
// before buying, where goods are delivered and how the order closes (prototype v5 `cellSrc` / `cellChk` / `cellLoc` /
// `cellPay`). Pure data; the keys named in the cells are the contract's.

import type { Bilingual } from "./package-data"
import type { PackageFlags } from "./package"

export interface StateRow {
  sources: Bilingual[]
  checks: Bilingual[]
  locations: Bilingual[]
  payment: Bilingual
}

export function stateRow(pkg: PackageFlags): StateRow {
  const sources: Bilingual[] = [pkg.pm ? ["المشاريع (prj:MR)", "Projects (prj:MR)"] : ["«طلب مواد» من الفريق", "Team material request"]]
  if (pkg.mfg) sources.push(["+ الورشة (mfg:PRQ)", "+ workshop (mfg:PRQ)"])
  sources.push(["+ سطر احتياج (inv:NEED)", "+ need line (inv:NEED)"])

  const checks: Bilingual[] = [["فحص المخزون (inv:CHK)", "Inventory check (inv:CHK)"]]
  if (pkg.mfg) checks.push(["+ «اسأل الورشة» (mfg:MK)", "+ “Ask the workshop” (mfg:MK)"])

  const locations: Bilingual[] = [pkg.pm ? ["مواقع المشاريع تلقائياً", "Project sites automatically"] : ["تُضاف يدوياً", "Added by hand"], ["+ المستودعات", "+ warehouses"]]
  if (pkg.mfg) locations.push(["+ مستودع الورشة", "+ workshop store"])

  const payment: Bilingual = pkg.fin
    ? ["من المالية · الأمر يُقفل بالسداد", "From Finance · PO closes when paid"]
    : ["حالة اختيارية + «صدّر للمحاسبة» · يُقفل بالاستلام", "Optional status + accountant export · closes on receipt"]
  return { sources, checks, locations, payment }
}
