"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useLocale, useTranslations } from "next-intl"
import { getDownloadURL, ref as storageRef } from "firebase/storage"
import { ExternalLink, FileArchive, FileImage, FileSpreadsheet, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Chip } from "@/components/module-ui/Chip"
import { IconButton } from "@/components/module-ui/IconButton"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { CrmPanel } from "@/components/crm/CrmShell"
import { OfferPdfButton } from "@/components/crm/OfferPdfButton"
import { useFirestore, useStorage } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { OPPORTUNITY_FILE_KINDS, formatCrmDate, type CrmContact, type CrmOpportunity, type CrmQuotation, type OpportunityFileKind } from "@/lib/crm"
import {
  addOpportunityFiles,
  deleteOpportunityFile,
  oppFileAllowed,
  type OppActor,
  type OpportunityFile,
} from "@/lib/crm-opportunity-writes"
import { cn } from "@/lib/utils"

/** A first guess at what a file is, from its name and type — the person adding it can change it before saving. */
export function guessFileKind(file: { name: string; type: string }): OpportunityFileKind {
  const name = file.name.toLowerCase()
  if (file.type.startsWith("image/")) return "site_photos"
  if (/\.(zip|dwg|dxf|rar)$/.test(name) || /مخطط|drawing/.test(name)) return "drawings"
  if (/\.(xlsx?|csv)$/.test(name) || /كميات|boq/.test(name)) return "boq"
  if (/كراسة|شروط|tender|rfp/.test(name)) return "tender_docs"
  if (/عقد|contract/.test(name)) return "contract"
  return "other"
}

function FileIcon({ file }: { file: Pick<OpportunityFile, "contentType" | "name"> }) {
  const Icon = file.contentType.startsWith("image/")
    ? FileImage
    : /\.(zip|rar)$/i.test(file.name)
      ? FileArchive
      : /sheet|excel|csv/.test(file.contentType)
        ? FileSpreadsheet
        : FileText
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
      <Icon size={16} />
    </span>
  )
}

/** Opens a stored file with a fresh link — never a stored public URL. */
async function openFile(storage: ReturnType<typeof useStorage>, path: string) {
  const url = await getDownloadURL(storageRef(storage, path))
  window.open(url, "_blank", "noopener,noreferrer")
}

/** A photo's thumbnail, loaded on demand; a click shows it full size in a new tab. */
function Thumb({ file, onOpen }: { file: OpportunityFile; onOpen: () => void }) {
  const storage = useStorage()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    getDownloadURL(storageRef(storage, file.path))
      .then((u) => live && setUrl(u))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [storage, file.path])
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative h-16 w-24 overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={file.name}
    >
      {url ? <Image src={url} alt={file.name} fill sizes="96px" className="object-cover" unoptimized /> : <FileImage size={16} className="m-auto text-muted-foreground" aria-hidden="true" />}
    </button>
  )
}

/**
 * «Files and photos» on a deal (OPP-10): upload any time, several at once, each with its kind and in the name of who
 * added it. Files from the add dialog and from activities land here too; Sales' offers appear here by themselves,
 * marked «from Sales», and cannot be removed from the deal. Only the person who added a file removes it.
 */
export function OppFilesPanel({
  opp,
  files,
  offers,
  contact,
  actor,
  canManage,
}: {
  opp: CrmOpportunity
  files: OpportunityFile[]
  /** Every offer version Sales sent on this deal. */
  offers: CrmQuotation[]
  contact: CrmContact | null
  actor: OppActor
  canManage: boolean
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const storage = useStorage()
  const { toast } = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<OpportunityFileKind | "all">("all")
  const [pending, setPending] = useState<Array<{ file: File; kind: OpportunityFileKind }>>([])
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<OpportunityFile | null>(null)

  const counts = useMemo(() => {
    const out: Partial<Record<OpportunityFileKind, number>> = {}
    for (const f of files) out[f.kind] = (out[f.kind] || 0) + 1
    out.quotation = (out.quotation || 0) + offers.length
    return out
  }, [files, offers])
  const total = files.length + offers.length
  const shown = files.filter((f) => filter === "all" || f.kind === filter)
  const showOffers = filter === "all" || filter === "quotation"

  const pick = (list: FileList | null) => {
    if (!list) return
    const next: Array<{ file: File; kind: OpportunityFileKind }> = []
    for (const file of Array.from(list)) {
      const check = oppFileAllowed(file)
      if (check !== "ok") {
        toast({ variant: "destructive", title: t(`crm_file_err_${check}`, { name: file.name }) })
        continue
      }
      next.push({ file, kind: guessFileKind(file) })
    }
    setPending((p) => [...p, ...next])
    if (input.current) input.current.value = ""
  }

  const upload = async () => {
    if (!firestore || pending.length === 0) return
    setBusy(true)
    try {
      await addOpportunityFiles(firestore, storage, opp, actor, pending, "page")
      toast({ title: t("crm_files_added", { count: pending.length }) })
      setPending([])
    } catch (err) {
      console.error(err)
      toast({ variant: "destructive", title: t("crm_save_error") })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!firestore || !removing) return
    try {
      await deleteOpportunityFile(firestore, storage, opp, removing, actor)
      toast({ title: t("crm_file_deleted") })
    } catch (err) {
      console.error(err)
      toast({ variant: "destructive", title: t("crm_save_error") })
    } finally {
      setRemoving(null)
    }
  }

  const sourceLabel = (f: OpportunityFile) =>
    f.source === "activity" && f.activityTitle
      ? t("crm_file_from_activity", { title: f.activityTitle })
      : f.source === "add"
        ? t("crm_file_from_add")
        : f.source === "handover"
          ? t("crm_file_from_handover")
          : null

  return (
    <CrmPanel
      icon={Paperclip}
      title={t("crm_files_title")}
      count={total}
      action={
        canManage ? (
          <>
            <input ref={input} type="file" multiple className="sr-only" aria-label={t("crm_files_add")} onChange={(e) => pick(e.target.files)} />
            <Button size="sm" className="h-8 gap-1.5" onClick={() => input.current?.click()} disabled={busy}>
              <Upload size={13} aria-hidden="true" />
              {t("crm_files_add")}
            </Button>
          </>
        ) : undefined
      }
    >
      {total > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b px-4 py-2.5" role="group" aria-label={t("crm_files_filter")}>
          <Chip selected={filter === "all"} onClick={() => setFilter("all")} count={total}>
            {t("crm_tab_all")}
          </Chip>
          {OPPORTUNITY_FILE_KINDS.filter((k) => counts[k]).map((k) => (
            <Chip key={k} selected={filter === k} onClick={() => setFilter(k)} count={counts[k]}>
              {t(`crm_file_kind_${k}`)}
            </Chip>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-2 border-b bg-muted/20 p-4">
          <p className="text-xs font-bold">{t("crm_files_pending")}</p>
          <ul className="space-y-1.5">
            {pending.map((p, i) => (
              <li key={`${p.file.name}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate" dir="auto">{p.file.name}</span>
                <NativeSelect
                  aria-label={t("crm_file_kind")}
                  className="h-8 w-44 text-xs"
                  value={p.kind}
                  onChange={(e) => setPending((list) => list.map((x, j) => (j === i ? { ...x, kind: e.target.value as OpportunityFileKind } : x)))}
                >
                  {OPPORTUNITY_FILE_KINDS.filter((k) => k !== "quotation").map((k) => (
                    <option key={k} value={k}>
                      {t(`crm_file_kind_${k}`)}
                    </option>
                  ))}
                </NativeSelect>
                <IconButton icon={Trash2} iconSize={13} label={t("crm_delete_btn")} onClick={() => setPending((list) => list.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void upload()} disabled={busy} className="gap-1.5">
              {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Upload size={13} aria-hidden="true" />}
              {t("crm_files_upload", { count: pending.length })}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPending([])} disabled={busy}>
              {t("crm_cancel")}
            </Button>
          </div>
        </div>
      )}

      {total === 0 && pending.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("crm_files_empty")}</p>
      ) : (
        <ul className="divide-y">
          {shown.map((f) => (
            <li key={f.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <FileIcon file={f} />
              <div className="min-w-[12rem] flex-1 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  <bdi dir="auto" className="break-all">{f.name}</bdi>
                  <Badge variant="outline" className="text-[10px]">{t(`crm_file_kind_${f.kind}`)}</Badge>
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {[t("crm_file_added_by", { name: f.byName }), formatCrmDate(f.at, locale), sourceLabel(f)].filter(Boolean).join(" · ")}
                </p>
                {f.contentType.startsWith("image/") && <Thumb file={f} onOpen={() => void openFile(storage, f.path)} />}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => void openFile(storage, f.path)}>
                  <ExternalLink size={12} aria-hidden="true" />
                  {t("crm_file_open")}
                </Button>
                {f.byId === actor.uid && (
                  <IconButton icon={Trash2} iconSize={13} label={t("crm_delete_btn")} onClick={() => setRemoving(f)} className="hover:text-destructive" />
                )}
              </div>
            </li>
          ))}
          {showOffers &&
            offers.map((q) => (
              <li key={q.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo/10 text-indigo" aria-hidden="true">
                  <FileText size={16} />
                </span>
                <div className="min-w-[12rem] flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    <bdi dir="ltr">{q.quotationNumber}.pdf</bdi>
                    <Badge variant="outline" className="border-indigo/20 bg-indigo/10 text-[10px] text-indigo">{t("crm_from_sales")}</Badge>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {[t("crm_file_kind_quotation"), t(q.supersededById ? "crm_offer_superseded" : "crm_offer_current"), q.sentAt ? t("crm_offer_arrived", { date: formatCrmDate(q.sentAt, locale) }) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <OfferPdfButton quote={q} contact={contact} className={cn("shrink-0")} />
              </li>
            ))}
        </ul>
      )}

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("crm_file_delete_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("crm_file_delete_desc", { name: removing?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("crm_cancel")}</AlertDialogCancel>
            <AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={() => void remove()}>
              {t("crm_delete_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmPanel>
  )
}
