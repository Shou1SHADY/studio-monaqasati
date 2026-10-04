"use client"

// Attachments on the employee file (PRD EM-07): the iqama image, the contract,
// a medical report, a penalty decision, the bank document. Upload goes to
// Storage under the org and the employee, then an append-only entry names it;
// opening asks Storage for a fresh link — no public link is ever kept.

import { useId, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, orderBy, query } from "firebase/firestore"
import { getDownloadURL, ref, uploadBytes } from "firebase/storage"
import { Loader2, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Panel } from "@/components/module-ui/Panel"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useStorage } from "@/firebase/provider"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { ATTACHMENT_KINDS, attachmentBlocks, attachmentPath, HR_FILES, type AttachmentKind, type EmployeeFile } from "@/lib/hr/attachments"
import { HR_EMPLOYEES } from "@/lib/hr/collections"
import type { HrEmployee } from "@/lib/hr/employee"
import { attachEmployeeFile, type HrActor } from "@/lib/hr/employee-writes"
import { hrDate } from "@/lib/hr/format"
import { HrWriteError } from "@/lib/hr/write-guard"

export function HrEmployeeFiles({ access, actor, emp }: { access: HrAccess; actor: HrActor; emp: HrEmployee }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const storage = useStorage()
  const { toast } = useToast()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<AttachmentKind>("iqama")
  const [busy, setBusy] = useState(false)
  const mayAttach = access.allowed("documents.manage") && emp.status !== "left"
  const filesQ = useMemoFirebase(() => (firestore ? query(collection(firestore, HR_EMPLOYEES, emp.id, HR_FILES), orderBy("at", "desc")) : null), [firestore, emp.id])
  const { data } = useCollection(filesQ)
  const files = (data ?? []) as unknown as EmployeeFile[]

  const say = (err: unknown) => {
    console.error(err)
    toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `files.block.${err.blocks[0]}` : `err.${err.code}`) : "files.err_upload"), variant: "destructive" })
  }

  const pick = async (file: File | undefined) => {
    if (!file || !storage || !firestore || !access.orgId) return
    const path = attachmentPath(emp.organizationId, emp.id, file.name, Date.now())
    const blocks = attachmentBlocks({ kind, name: file.name, size: file.size, contentType: file.type, path }, { orgId: emp.organizationId, employeeId: emp.id })
    if (blocks.length) {
      toast({ title: t(`files.block.${blocks[0]}`), variant: "destructive" })
      return
    }
    setBusy(true)
    try {
      await uploadBytes(ref(storage, path), file, { contentType: file.type })
      await attachEmployeeFile(firestore, access.ctx, emp.id, actor, { kind, name: file.name, size: file.size, contentType: file.type, path })
      toast({ title: t("files.attached") })
    } catch (err) {
      say(err)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const open = async (f: EmployeeFile) => {
    if (!storage) return
    try {
      window.open(await getDownloadURL(ref(storage, f.path)), "_blank", "noopener,noreferrer")
    } catch (err) {
      say(err)
    }
  }

  return (
    <Panel title={t("files.title")} icon={Paperclip} count={files.length}>
      {files.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{t("files.none")}</p>
      ) : (
        <ul className="divide-y">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <button
                type="button"
                onClick={() => void open(f)}
                className="min-w-0 truncate rounded text-start font-semibold text-module underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                dir="auto"
              >
                {f.name}
              </button>
              <span className="text-xs text-muted-foreground">
                {t(`files.kind.${f.kind}`)} · {f.byName || "—"} · {hrDate(f.at?.slice(0, 10), locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {mayAttach && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${inputId}-kind`}>{t("files.kind_label")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as AttachmentKind)} disabled={busy}>
              <SelectTrigger id={`${inputId}-kind`} className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ATTACHMENT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`files.kind.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-9" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <Paperclip size={14} className="me-1.5" aria-hidden="true" />}
            {t(busy ? "files.uploading" : "files.attach")}
          </Button>
          <input ref={inputRef} id={inputId} type="file" accept="image/*,application/pdf" className="hidden" aria-label={t("files.attach")} onChange={(e) => void pick(e.target.files?.[0])} />
          <p className="basis-full text-[11px] text-muted-foreground">{t("files.note")}</p>
        </div>
      )}
    </Panel>
  )
}
