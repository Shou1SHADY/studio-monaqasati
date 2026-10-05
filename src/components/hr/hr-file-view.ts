// What every segment of the employee file reads (PRD EM-01, the prototype's openEmp): the person, the viewer's
// access, the facts computed once by the file, and a way to open an action. Types only.

import type { HrAccess } from "@/hooks/useHrAccess"
import type { DocRow } from "@/lib/hr/documents"
import type { EmployeePay, HrEmployee, LineManagerVia, TodayState } from "@/lib/hr/employee"
import type { HrActor, LogEntry } from "@/lib/hr/employee-writes"
import type { HrRequest } from "@/lib/hr/requests"
import type { HrSite } from "@/lib/hr/sites"
import type { HrViolation } from "@/lib/hr/violations"
import type { WorkplaceMonth } from "@/lib/hr/attendance"
import type { EmployeeAction } from "./EmployeeActionDialogs"
import type { HrPortal } from "./HrShell"

export interface FileView {
  access: HrAccess
  actor: HrActor
  portal: HrPortal
  emp: HrEmployee
  /** The pay in force today — null for a viewer who may not see it (RL-03). */
  pay: EmployeePay | null
  money: boolean
  employees: HrEmployee[]
  sites: HrSite[]
  site: HrSite | null
  siteName: (id: string | null | undefined) => string | null
  today: string
  locale: string
  requests: HrRequest[]
  violations: HrViolation[]
  log: Array<LogEntry & { id: string }>
  rows: DocRow[]
  manager: { id: string | null; via: LineManagerVia; derived: boolean; name: string | null }
  todayState: TodayState
  thisWm: WorkplaceMonth | null
  lastWm: WorkplaceMonth | null
  /** Presence assumed at his place (an office, unassigned — AT-02). */
  assumed: boolean
  service: number
  entitlement: number
  balance: number | null
  wage: number
  open: (action: EmployeeAction, opts?: { docType?: string | null; requestId?: string | null }) => void
}
