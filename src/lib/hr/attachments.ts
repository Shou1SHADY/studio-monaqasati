// HR 1.0 — attachments on the employee record (PRD EM-07): the iqama image,
// the contract, a medical report, a penalty decision, the bank document. The
// file lives in Storage under the org and the employee; the record keeps an
// append-only entry `employees/{id}/files/{fileId}` naming it — its kind, name,
// Storage path (never a public download link), who attached it and when. Read
// by HR staff who handle documents or pay, and by the employee himself — never
// by a supervisor (a medical report and a bank letter are not his to see).
// Pure: no I/O.

/** `employees/{id}/files` — append-only. */
export const HR_FILES = "files"

export const ATTACHMENT_KINDS = ["iqama", "passport", "contract", "medical", "penalty", "bank", "other"] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

/** 15 MB — the size every module's upload accepts. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

export interface EmployeeFile {
  id: string
  organizationId: string
  employeeId: string
  kind: AttachmentKind
  name: string
  /** The Storage object path — opened through a fresh download link, never stored as one. */
  path: string
  size: number
  contentType: string
  by: string
  byName: string | null
  at: string
  note?: string | null
}

/** Where an employee's file is stored. */
export function attachmentPath(orgId: string, employeeId: string, fileName: string, stamp: number): string {
  const safe = fileName.replace(/[^\w.\-؀-ۿ]+/g, "_").slice(-120) || "file"
  return `organizations/${orgId}/hr/employees/${employeeId}/${stamp}_${safe}`
}

export type AttachmentBlock = "no_file" | "too_big" | "bad_type" | "bad_kind" | "bad_path"

/** Images and PDFs only, at most 15 MB, of a known kind, stored under this employee's folder. */
export function attachmentBlocks(input: { kind: string; name: string; size: number; contentType: string; path?: string | null }, where?: { orgId: string; employeeId: string }): AttachmentBlock[] {
  const out: AttachmentBlock[] = []
  if (!input.name || !(input.size > 0)) out.push("no_file")
  else if (input.size > MAX_ATTACHMENT_BYTES) out.push("too_big")
  if (input.name && !(input.contentType.startsWith("image/") || input.contentType === "application/pdf")) out.push("bad_type")
  if (!ATTACHMENT_KINDS.includes(input.kind as AttachmentKind)) out.push("bad_kind")
  if (where && !(input.path ?? "").startsWith(`organizations/${where.orgId}/hr/employees/${where.employeeId}/`)) out.push("bad_path")
  return out
}
