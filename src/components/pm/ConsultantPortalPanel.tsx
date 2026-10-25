"use client"

// The consultant portal under File › Correspondence (the prototype's بوابة
// الاستشاري). What he is waiting on is read from the project's own records —
// seven sources, each only while its section is on (CP-06). The link — one per
// project — goes to his representative's mobile from the project's details
// (PRJ-01, CP-02): without one the panel asks to add it. It is made on the
// server (`/api/pm-portal`): a resend is a new code on the same link, counted
// (CP-03); "opened" is recorded when his code is verified. "What he sees" stays
// a preview with its buttons disabled on purpose: his screen, not ours. A
// certificate's amount shows only to whoever sees money (CP-14).

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc } from "firebase/firestore"
import { Check, CheckCircle2, Clock, Copy, Eye, Link2, Loader2, MessageCircle, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import type { PmCertificate } from "@/lib/pm/certificate-writes"
import { PM_CLAIMS, type PmClaim } from "@/lib/pm/claim"
import { portalAge, portalItems, PORTAL_LATE_DAYS, type PmPortalState, type PortalItem } from "@/lib/pm/consultant-portal"
import { letterLabel, type PmLetter } from "@/lib/pm/correspondence"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { PM_INSPECTIONS, type PmInspection } from "@/lib/pm/inspection"
import { PM_NCRS, type PmNcr } from "@/lib/pm/ncr"
import { PM_PUNCH, type PunchItem } from "@/lib/pm/punch"
import { PM_SUBMITTALS, type PmSubmittal } from "@/lib/pm/sample"
import { cn } from "@/lib/utils"
import { ConsultantRepDialog, type ConsultantDetails } from "./ConsultantRepDialog"

const NO_KEY: Record<PortalItem["kind"], string> = { subm: "sample.no", wir: "wir.no", punch: "punch.no", ncr: "ncr.no", corr: "", ipc: "ipc.no", claim: "claim.no" }

type ProjectDoc = ConsultantDetails & { enabledSections?: string[]; pm?: { portal?: PmPortalState | null } | null }

/** "+966501234567" → "05••••4567". */
const maskLocal = (e164: string | null | undefined) => (e164 && e164.length >= 8 ? `05••••${e164.slice(-4)}` : "")

export function ConsultantPortalPanel({
  projectId,
  projectName,
  portal: portalProp,
  letters,
  items,
  access,
}: {
  projectId: string
  projectName: string
  portal: { sentOn?: string | null; seenOn?: string | null; name?: string | null; phoneMasked?: string | null } | null
  letters: PmLetter[]
  items: Array<{ id: string; code: string; description: string }>
  access: PmAccess
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const today = todayDay()
  const { user } = useUser()
  const money = access.has("money")
  const [preview, setPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [editingRep, setEditingRep] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; phoneMasked: string; sent: boolean; sends: number; reused: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  const projectRef = useMemoFirebase(() => (firestore ? doc(firestore, "projects", projectId) : null), [firestore, projectId])
  const { data: projectDoc } = useDoc<ProjectDoc>(projectRef)
  const subQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_SUBMITTALS) : null), [firestore, projectId])
  const wirQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_INSPECTIONS) : null), [firestore, projectId])
  const punchQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_PUNCH) : null), [firestore, projectId])
  const ncrQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_NCRS) : null), [firestore, projectId])
  const claimQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_CLAIMS) : null), [firestore, projectId])
  // Certificates are readable by money holders only (the rules say so).
  const certQ = useMemoFirebase(() => (firestore && money ? collection(firestore, "projects", projectId, PM_CERTIFICATES) : null), [firestore, projectId, money])
  const { data: subs } = useCollection(subQ)
  const { data: wirs } = useCollection(wirQ)
  const { data: punch } = useCollection(punchQ)
  const { data: ncrs } = useCollection(ncrQ)
  const { data: claims } = useCollection(claimQ)
  const { data: certs } = useCollection(certQ)

  const certNet = useMemo(() => new Map(((certs ?? []) as unknown as PmCertificate[]).map((c) => [String(c.seq).padStart(2, "0"), c.gross])), [certs])
  const pending = useMemo(() => {
    const itemName = (id: string, code?: string | null) => {
      const i = items.find((x) => x.id === id)
      return [code ?? i?.code, i?.description].filter(Boolean).join(" · ") || id
    }
    return portalItems({
      submittals: ((subs ?? []) as unknown as PmSubmittal[]).map((s) => ({ seq: s.seq, status: s.status, day: s.day, title: itemName(s.itemId, s.code) })),
      inspections: ((wirs ?? []) as unknown as PmInspection[]).map((w) => ({
        seq: w.seq,
        status: w.status,
        party: w.party,
        day: w.attempts?.[w.attempts.length - 1]?.on ?? today,
        location: w.location,
      })),
      punch: ((punch ?? []) as unknown as PunchItem[]).map((p) => ({ seq: p.seq, status: p.status, source: p.source, day: p.day, fixOn: p.fix?.on ?? null, what: p.what })),
      letters,
      ncrs: ((ncrs ?? []) as unknown as PmNcr[]).map((n) => ({ seq: n.seq, status: n.status, day: n.day, planOn: n.plan?.on ?? null, title: [n.code, n.root].filter(Boolean).join(" · ") })),
      certificates: ((certs ?? []) as unknown as PmCertificate[]).map((c) => ({ seq: c.seq, status: c.status, apprOn: c.apprOn ?? null, prepOn: c.prepOn, title: [c.periodFrom, c.periodTo].filter(Boolean).map((d) => pmDate(d, locale)).join(" — ") })),
      claims: ((claims ?? []) as unknown as PmClaim[]).map((c) => ({ seq: c.seq, status: c.status, submittedOn: c.submittedOn ?? null, eventOn: c.eventOn, cause: c.cause })),
      sections: projectDoc?.enabledSections?.length ? projectDoc.enabledSections : null,
    })
  }, [subs, wirs, punch, ncrs, certs, claims, letters, items, today, projectDoc?.enabledSections, locale])

  const portal = projectDoc ? (projectDoc.pm?.portal ?? null) : portalProp
  const oldest = pending.length ? portalAge(pending[0].day, today) : 0
  const sentOn = portal?.sentOn ?? null
  const seenOn = portal?.seenOn ?? null
  const sends = (portal as PmPortalState | null)?.sends ?? (sentOn ? 1 : 0)
  const rep = projectDoc?.consultantRep ?? null
  const hasRep = Boolean(projectDoc?.consultant?.trim() && rep?.phone)
  const canManage = !access.ctx.archived && access.allowed("consultantPortal.manage")
  const canEditRep = !access.ctx.archived && access.allowed("project.edit")

  const send = async () => {
    if (!user) return
    setBusy(true)
    setError(null)
    setResult(null)
    setCopied(false)
    setSending(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/pm-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ projectId }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const code = body?.code as string | undefined
        setError(t(code === "NO_REP" ? "portal.no_rep" : code === "FORBIDDEN" ? "portal.err_forbidden" : code === "PROJECT_CLOSED" ? "portal.err_closed" : "portal.err_send"))
        return
      }
      setResult(body.data)
    } catch {
      setError(t("portal.err_send"))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result.url).catch(() => undefined)
    setCopied(true)
  }

  const label = (x: PortalItem) => (x.kind === "corr" ? letterLabel({ dir: "out", no: x.no }, locale) : t(NO_KEY[x.kind], { no: x.no }))
  const titleOf = (x: PortalItem) => (x.kind === "ipc" ? [x.title, money && certNet.has(x.no) ? pmMoney(certNet.get(x.no) ?? 0) : ""].filter(Boolean).join(" · ") : x.title)

  const gate = (ok: boolean, title: string, sub: string) => (
    <div className={cn("flex items-start gap-2 rounded-xl border p-3", ok ? "border-success/30 bg-success/5" : "bg-muted/40")}>
      {ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" /> : <Clock size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <div className="min-w-0">
        <p className="text-sm font-bold">{title}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  )

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {t("portal.title")}
          <StatusPill tone={pending.length ? "warn" : "ok"}>{pending.length}</StatusPill>
        </span>
      }
      icon={Link2}
      actions={
        canManage ? (
          <>
            <Button size="sm" onClick={() => void send()} disabled={!hasRep || busy}>
              {busy ? <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" /> : <Link2 size={15} className="me-1.5" aria-hidden="true" />}
              {sentOn ? t("portal.resend") : t("portal.send")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreview(true)}>
              <Eye size={15} className="me-1.5" aria-hidden="true" />
              {t("portal.view")}
            </Button>
          </>
        ) : null
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">{t("portal.sub")}</p>
      {projectDoc && !hasRep && (
        <Callout tone="warn" className="mb-3">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("portal.no_rep")}</span>
            {canEditRep && (
              <Button size="sm" variant="outline" onClick={() => setEditingRep(true)}>
                <UserPlus size={14} className="me-1.5" aria-hidden="true" />
                {t("portal.add_rep")}
              </Button>
            )}
          </span>
        </Callout>
      )}
      {hasRep && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span dir="auto">{t("portal.goes_to", { name: rep?.name || projectDoc?.consultant || "—", phone: maskLocal(rep?.phone) })}</span>
          {canEditRep && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setEditingRep(true)}>
              {t("portal.edit_rep")}
            </Button>
          )}
        </p>
      )}
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {gate(
          Boolean(sentOn),
          t("portal.sent"),
          sentOn
            ? [t("portal.sent_on", { date: pmDate(sentOn, locale) }), portal?.name ? t("portal.sent_to", { name: portal.name, phone: portal.phoneMasked ?? "" }) : "", sends > 1 ? t("portal.sends", { count: sends }) : ""].filter(Boolean).join(" · ")
            : t("portal.not_sent")
        )}
        {gate(Boolean(seenOn), t("portal.opened"), seenOn ? t("portal.opened_on", { date: pmDate(seenOn, locale) }) : t("portal.not_opened"))}
        {gate(pending.length === 0, t("portal.answered"), pending.length ? t("portal.pending", { count: pending.length, age: t("days", { count: oldest }) }) : t("portal.nothing_pending"))}
      </div>

      {pending.length === 0 ? (
        <p className="rounded-xl border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">{t("portal.empty")}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {pending.slice(0, 6).map((x) => {
            const age = portalAge(x.day, today)
            const title = titleOf(x)
            return (
              <li key={`${x.kind}-${x.no}`} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    <bdi>{label(x)}</bdi>
                    {title ? (
                      <>
                        {" — "}
                        <span dir="auto">{title}</span>
                      </>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`portal.item.${x.kind}`)} · {t("portal.for", { age: t("days", { count: age }) })}
                  </p>
                </div>
                <StatusPill tone={age > PORTAL_LATE_DAYS ? "bad" : "mute"}>{pmDate(x.day, locale)}</StatusPill>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-muted-foreground">{t("portal.foot")}</p>

      <ConsultantRepDialog open={editingRep} onOpenChange={setEditingRep} projectId={projectId} project={projectDoc ?? {}} linkSent={Boolean(sentOn)} />

      <Dialog open={sending} onOpenChange={(o) => !busy && setSending(o)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{sentOn ? t("portal.resend_title") : t("portal.send_title")}</DialogTitle>
            <DialogDescription>{t("portal.send_desc")}</DialogDescription>
          </DialogHeader>
          {busy ? (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin text-muted-foreground" size={22} aria-label={t("portal.sending")} />
            </div>
          ) : result ? (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
                <Check size={16} aria-hidden="true" />
                {result.sent ? t("portal.link_texted", { phone: result.phoneMasked }) : t("portal.link_ready", { phone: result.phoneMasked })}
              </p>
              {result.reused && <Callout tone="info">{t("portal.resend_same", { count: result.sends })}</Callout>}
              <Input readOnly value={result.url} dir="ltr" className="h-10 text-xs" aria-label={t("portal.link_label")} onFocus={(e) => e.currentTarget.select()} />
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={copy}>
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied ? t("portal.copied") : t("portal.copy")}
                </Button>
                <Button asChild className="h-10 gap-1.5">
                  <a href={`https://wa.me/?text=${encodeURIComponent(t("portal.share_text", { project: projectName, url: result.url }))}`} target="_blank" rel="noopener noreferrer">
                    <MessageCircle size={14} aria-hidden="true" />
                    {t("portal.whatsapp")}
                  </a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("portal.send_how")}</p>
            </div>
          ) : (
            error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )
          )}
          <DialogFooter>
            <Button disabled={busy} onClick={() => setSending(false)}>
              {t("portal.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={preview} onOpenChange={setPreview}>
        <SheetContent side={locale === "ar" ? "left" : "right"} className="w-full overflow-y-auto sm:max-w-lg" dir={locale === "ar" ? "rtl" : "ltr"}>
          <SheetHeader className="text-start">
            <SheetTitle className="flex items-center gap-2">
              <Eye size={18} className="text-module" aria-hidden="true" />
              {t("portal.preview_title")}
            </SheetTitle>
            <SheetDescription className="flex flex-wrap items-center gap-2">
              <StatusPill tone="module">
                <span dir="auto">{projectName}</span>
              </StatusPill>
              {t("portal.preview_tag")}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            <Callout tone="info">{t("portal.preview_note")}</Callout>
            <DrawerSection title={t("portal.page", { project: projectName })}>
              <KeyValueRow label={t("portal.k_access")} value={t("portal.v_access")} />
              <KeyValueRow label={t("portal.k_sees")} value={t("portal.v_sees")} />
              <KeyValueRow label={t("portal.k_never")} value={t("portal.v_never_11")} />
              <KeyValueRow label={t("portal.k_can")} value={t("portal.v_can_live")} />
            </DrawerSection>
            <DrawerSection title={t("portal.pending_title")} count={pending.length}>
              {pending.length === 0 ? (
                <p className="py-3 text-center text-sm text-muted-foreground">{t("portal.nothing")}</p>
              ) : (
                <ul className="divide-y">
                  {pending.map((x) => (
                    <li key={`${x.kind}-${x.no}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold">
                          <bdi>{label(x)}</bdi>
                        </p>
                        {titleOf(x) && (
                          <p className="text-xs text-muted-foreground" dir="auto">
                            {titleOf(x)}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">{t(`portal.item.${x.kind}`)}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="border-success/40 text-success" disabled>
                          {t("portal.accept")}
                        </Button>
                        <Button size="sm" variant="outline" className="border-destructive/40 text-destructive" disabled>
                          {t("portal.reject")}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DrawerSection>
            <p className="text-xs text-muted-foreground">{t("portal.preview_foot")}</p>
          </div>
        </SheetContent>
      </Sheet>
    </Panel>
  )
}
