"use client"

// The documents component (DEV-68, Odoo's chatter): on a document that links a
// buyer and a supplier — comments, attachments, the history of everything that
// happened to it, and its follow-ups. A comment or file is either shared with the
// other company or kept inside the author's own; the thread is written once and
// never edited.

import { useId, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getDownloadURL, ref, uploadBytes } from "firebase/storage"
import { Clock, Eye, EyeOff, Loader2, MessageSquare, Paperclip, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Chip } from "@/components/module-ui/Chip"
import { Panel } from "@/components/module-ui/Panel"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { RecordActivities } from "@/components/activities/RecordActivities"
import { useFirestore, useStorage, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useActivities } from "@/hooks/useActivities"
import { useDocumentThread } from "@/hooks/useDocumentThread"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { forRecord, isOpen, targetKeyOf } from "@/lib/activities"
import type { ActivityPortal } from "@/lib/activity-writes"
import {
  BODY_MAX,
  canShare,
  fileSizeLabel,
  historyOf,
  sideOf,
  threadBlocks,
  threadFilePath,
  threadKey,
  type DocParties,
  type HostLogItem,
  type ThreadEntry,
  type ThreadTarget,
  type Visibility,
} from "@/lib/document-thread"
import { ThreadError, attachThreadFile, postComment, type ThreadNotify } from "@/lib/document-thread-writes"

type Tab = "comments" | "files" | "history" | "followups"

export interface DocumentThreadProps {
  target: ThreadTarget
  portal: ActivityPortal
  parties: DocParties
  /** Who to tell on each side when something is shared. */
  notify?: ThreadNotify
  /** The document's own log, already in words — it joins the history. */
  log?: HostLogItem[]
  className?: string
}

const when = (iso: string, locale: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

export function DocumentThread({ target, portal, parties, notify, log = [], className }: DocumentThreadProps) {
  const t = useTranslations("Portal.Thread")
  const locale = useLocale()
  const { user } = useUser()
  const { organizationId } = useResolvedProfile(user?.uid)
  const key = threadKey(target.kind, target.id)
  const { entries } = useDocumentThread(key, organizationId)
  const { activities } = useActivities(organizationId || null)
  const [tab, setTab] = useState<Tab>("comments")

  const mine = useMemo(() => forRecord(activities, targetKeyOf({ kind: target.kind, id: target.id }) ?? ""), [activities, target.kind, target.id])
  const comments = entries.filter((e) => e.kind === "comment")
  const files = entries.filter((e) => e.kind === "file")
  const history = useMemo(() => historyOf(entries, mine, log), [entries, mine, log])
  const side = sideOf(organizationId || "", parties)

  return (
    <Panel title={t("title")} icon={MessageSquare} className={className} bodyClassName="space-y-3">
      <SegmentedNav
        ariaLabel={t("title")}
        active={tab}
        onSelect={(id) => setTab(id as Tab)}
        segments={[
          { id: "comments", label: t("tab_comments"), count: comments.length },
          { id: "files", label: t("tab_files"), count: files.length },
          { id: "history", label: t("tab_history") },
          { id: "followups", label: t("tab_followups"), count: mine.filter(isOpen).length },
        ]}
      />
      {tab === "comments" && <Stream entries={comments} locale={locale} parties={parties} empty={t("comments_empty")} orgId={organizationId || ""} />}
      {tab === "files" && <FileList entries={files} locale={locale} parties={parties} orgId={organizationId || ""} />}
      {tab === "history" && <History items={history} locale={locale} />}
      {tab === "followups" && <RecordActivities target={{ kind: target.kind, id: target.id, label: target.label, href: target.href }} portal={portal} className="border-0" />}
      {(tab === "comments" || tab === "files") && (side ? <Composer tab={tab} target={target} parties={parties} notify={notify} orgId={organizationId || ""} /> : <p className="text-xs text-muted-foreground">{t("read_only")}</p>)}
    </Panel>
  )
}

function Audience({ entry, parties, orgId }: { entry: ThreadEntry; parties: DocParties; orgId: string }) {
  const t = useTranslations("Portal.Thread")
  const shared = entry.buyerOrgId !== null && entry.supplierOrgId !== null
  const mineSide = sideOf(orgId, parties)
  const other = mineSide === "buyer" ? t("party_supplier") : t("party_buyer")
  return (
    <StatusPill tone={shared ? "info" : "mute"}>
      {shared ? <Eye size={11} aria-hidden="true" /> : <EyeOff size={11} aria-hidden="true" />}
      {shared ? t("shared_with", { party: other }) : t("internal")}
    </StatusPill>
  )
}

function Stream({ entries, locale, parties, empty, orgId }: { entries: ThreadEntry[]; locale: string; parties: DocParties; empty: string; orgId: string }) {
  if (!entries.length) return <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-3">
      {entries.map((e) => (
        <li key={e.id} className="rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold" dir="auto">
              {e.authorName || "—"}
              {e.authorOrgId === orgId ? null : <span className="ms-1 text-xs font-normal text-muted-foreground">·</span>}
            </p>
            <div className="flex items-center gap-2">
              <Audience entry={e} parties={parties} orgId={orgId} />
              <span className="text-[11px] text-muted-foreground">{when(e.at, locale)}</span>
            </div>
          </div>
          <p className="mt-1 whitespace-pre-line text-sm" dir="auto">
            {e.body}
          </p>
        </li>
      ))}
    </ul>
  )
}

function FileList({ entries, locale, parties, orgId }: { entries: ThreadEntry[]; locale: string; parties: DocParties; orgId: string }) {
  const t = useTranslations("Portal.Thread")
  const storage = useStorage()
  const { toast } = useToast()
  const open = async (path: string) => {
    if (!storage) return
    try {
      window.open(await getDownloadURL(ref(storage, path)), "_blank", "noopener,noreferrer")
    } catch (err) {
      console.error(err)
      toast({ title: t("open_failed"), variant: "destructive" })
    }
  }
  if (!entries.length) return <p className="py-4 text-center text-sm text-muted-foreground">{t("files_empty")}</p>
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => e.file && void open(e.file.path)}
              className="max-w-full truncate rounded text-start font-semibold text-cta underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              dir="auto"
            >
              {e.file?.name}
            </button>
            <p className="text-xs text-muted-foreground" dir="auto">
              {e.file ? fileSizeLabel(e.file.size) : ""} · {e.authorName || "—"} · {when(e.at, locale)}
              {e.body ? ` · ${e.body}` : ""}
            </p>
          </div>
          <Audience entry={e} parties={parties} orgId={orgId} />
        </li>
      ))}
    </ul>
  )
}

function History({ items, locale }: { items: ReturnType<typeof historyOf>; locale: string }) {
  const t = useTranslations("Portal.Thread")
  if (!items.length) return <p className="py-4 text-center text-sm text-muted-foreground">{t("history_empty")}</p>
  const line = (i: ReturnType<typeof historyOf>[number]): string => {
    switch (i.type) {
      case "comment":
        return t("h_comment", { name: i.entry.authorName, text: i.entry.body })
      case "file":
        return t("h_file", { name: i.entry.authorName, file: i.entry.file?.name ?? "" })
      case "activity_done":
        return t("h_activity_done", { name: i.activity.doneByName ?? "", summary: i.activity.summary })
      case "activity_cancelled":
        return t("h_activity_cancelled", { name: i.activity.doneByName ?? "", summary: i.activity.summary })
      default:
        return i.type === "host" ? `${i.item.byName ? `${i.item.byName} — ` : ""}${i.item.text}` : ""
    }
  }
  return (
    <ol className="space-y-2">
      {items.map((i) => (
        <li key={i.id} className="flex gap-2 text-sm">
          <Clock size={14} className="mt-1 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p dir="auto">{line(i)}</p>
            <p className="text-[11px] text-muted-foreground">{i.type.startsWith("activity_") ? when(i.at, locale).split(",")[0] : when(i.at, locale)}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Composer({ tab, target, parties, notify, orgId }: { tab: "comments" | "files"; target: ThreadTarget; parties: DocParties; notify?: ThreadNotify; orgId: string }) {
  const t = useTranslations("Portal.Thread")
  const firestore = useFirestore()
  const storage = useStorage()
  const { user } = useUser()
  const { profile } = useResolvedProfile(user?.uid)
  const { toast } = useToast()
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const sharable = canShare(parties)
  const [visibility, setVisibility] = useState<Visibility>(sharable ? "shared" : "internal")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const side = sideOf(orgId, parties)
  const other = side === "buyer" ? t("party_supplier") : t("party_buyer")
  const actor = { uid: user?.uid ?? "", name: ((profile as { name?: string } | null)?.name || user?.displayName || user?.email || "") as string, orgId }

  const fail = (err: unknown) => {
    console.error(err)
    toast({ title: err instanceof ThreadError && err.blocks[0] ? t(`block_${err.blocks[0]}`) : t("save_failed"), variant: "destructive" })
  }

  const send = async () => {
    if (!firestore || !user) return
    setBusy(true)
    try {
      await postComment(firestore, actor, { target, parties, visibility, notify, body })
      setBody("")
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const upload = async (file: File | undefined) => {
    if (!file || !firestore || !storage || !user) return
    setBusy(true)
    try {
      const path = threadFilePath(parties.buyerOrgId, threadKey(target.kind, target.id), file.name, Date.now())
      const meta = { name: file.name, size: file.size, contentType: file.type, path }
      const blocks = threadBlocks({ kind: "file", body, file: meta, visibility, side, parties })
      if (blocks.length) throw new ThreadError(blocks)
      await uploadBytes(ref(storage, path), file, { contentType: file.type })
      await attachThreadFile(firestore, actor, { target, parties, visibility, notify, file: meta, body })
      setBody("")
      toast({ title: t("attached") })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("visibility")}>
        <Chip selected={visibility === "shared"} icon={Eye} disabled={!sharable || busy} onClick={() => setVisibility("shared")}>
          {t("shared_with", { party: other })}
        </Chip>
        <Chip selected={visibility === "internal"} icon={EyeOff} disabled={busy} onClick={() => setVisibility("internal")}>
          {t("internal")}
        </Chip>
        {!sharable && <span className="text-[11px] text-muted-foreground">{t("guest_note")}</span>}
      </div>
      <Label htmlFor={`${id}-body`} className="sr-only">
        {tab === "comments" ? t("comment_label") : t("caption_label")}
      </Label>
      <Textarea id={`${id}-body`} dir="auto" rows={2} maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} placeholder={tab === "comments" ? t("comment_ph") : t("caption_ph")} disabled={busy} />
      <div className="flex justify-end gap-2">
        {tab === "comments" ? (
          <Button size="sm" onClick={() => void send()} disabled={busy || !body.trim()}>
            {busy ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <Send size={14} className="me-1.5 rtl:-scale-x-100" aria-hidden="true" />}
            {t("send")}
          </Button>
        ) : (
          <>
            <input ref={fileRef} type="file" className="hidden" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv" onChange={(e) => void upload(e.target.files?.[0])} aria-label={t("attach")} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <Paperclip size={14} className="me-1.5" aria-hidden="true" />}
              {t(busy ? "uploading" : "attach")}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
