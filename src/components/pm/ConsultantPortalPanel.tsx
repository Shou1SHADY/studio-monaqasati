"use client"

// The consultant portal under File › Correspondence (the prototype's بوابة
// الاستشاري). What he is waiting on is read from the project's own records;
// the link — one per project, a one-time code on his phone — is made on the
// server (`/api/pm-portal`), which revokes the one before and records "sent"
// on `pm.portal`; "opened" is recorded when his code is verified. "What he
// sees" stays a preview with its buttons disabled on purpose: his screen, not ours.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, getDoc } from "firebase/firestore"
import { Check, CheckCircle2, Clock, Copy, Eye, Link2, Loader2, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { portalAge, portalItems, PORTAL_LATE_DAYS, type PortalItem } from "@/lib/pm/consultant-portal"
import { letterLabel, type PmLetter } from "@/lib/pm/correspondence"
import { pmDate, todayDay } from "@/lib/pm/format"
import { PM_INSPECTIONS, type PmInspection } from "@/lib/pm/inspection"
import { PM_NCRS, type PmNcr } from "@/lib/pm/ncr"
import { PM_PUNCH, type PunchItem } from "@/lib/pm/punch"
import { PM_SUBMITTALS, type PmSubmittal } from "@/lib/pm/sample"
import { cn } from "@/lib/utils"

const NO_KEY: Record<PortalItem["kind"], string> = { subm: "sample.no", wir: "wir.no", punch: "punch.no", ncr: "ncr.no", corr: "" }

export function ConsultantPortalPanel({
  projectId,
  projectName,
  portal,
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
  const [preview, setPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; phoneMasked: string; sent: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  const subQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_SUBMITTALS) : null), [firestore, projectId])
  const wirQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_INSPECTIONS) : null), [firestore, projectId])
  const punchQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_PUNCH) : null), [firestore, projectId])
  const ncrQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_NCRS) : null), [firestore, projectId])
  const { data: subs } = useCollection(subQ)
  const { data: wirs } = useCollection(wirQ)
  const { data: punch } = useCollection(punchQ)
  const { data: ncrs } = useCollection(ncrQ)

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
    })
  }, [subs, wirs, punch, ncrs, letters, items, today])

  const oldest = pending.length ? portalAge(pending[0].day, today) : 0
  const sentOn = portal?.sentOn ?? null
  const seenOn = portal?.seenOn ?? null
  const canManage = !access.ctx.archived && access.allowed("consultantPortal.manage")
  const openSend = async () => {
    setName(portal?.name ?? "")
    setPhone("")
    setError(null)
    setResult(null)
    setCopied(false)
    setSending(true)
    if (!portal?.name && firestore) {
      const snap = await getDoc(doc(firestore, "projects", projectId)).catch(() => null)
      const consultant = (snap?.data() as { consultant?: string | null } | undefined)?.consultant
      if (consultant) setName((n) => n || consultant)
    }
  }

  const send = async () => {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch("/api/pm-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ projectId, name: name.trim(), phone: phone.trim() }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const code = body?.code as string | undefined
        setError(t(code === "NO_PHONE" ? "portal.err_phone" : code === "FORBIDDEN" ? "portal.err_forbidden" : code === "PROJECT_CLOSED" ? "portal.err_closed" : "portal.err_send"))
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
            <Button size="sm" onClick={openSend}>
              <Link2 size={15} className="me-1.5" aria-hidden="true" />
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
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {gate(
          Boolean(sentOn),
          t("portal.sent"),
          sentOn
            ? [t("portal.sent_on", { date: pmDate(sentOn, locale) }), portal?.name ? t("portal.sent_to", { name: portal.name, phone: portal.phoneMasked ?? "" }) : ""].filter(Boolean).join(" · ")
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
            return (
              <li key={`${x.kind}-${x.no}`} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    <bdi>{label(x)}</bdi> — <span dir="auto">{x.title}</span>
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

      <Dialog open={sending} onOpenChange={(o) => !busy && setSending(o)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{sentOn ? t("portal.resend_title") : t("portal.send_title")}</DialogTitle>
            <DialogDescription>{t("portal.send_desc")}</DialogDescription>
          </DialogHeader>
          {result ? (
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
                <Check size={16} aria-hidden="true" />
                {result.sent ? t("portal.link_texted", { phone: result.phoneMasked }) : t("portal.link_ready", { phone: result.phoneMasked })}
              </p>
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
            <div className="space-y-4">
              {sentOn && <Callout tone="warn">{t("portal.resend_note")}</Callout>}
              <div className="space-y-1">
                <Label htmlFor="cp-name">{t("portal.consultant_name")}</Label>
                <Input id="cp-name" dir="auto" className="h-11" value={name} maxLength={120} disabled={busy} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cp-phone">{t("portal.consultant_phone")}</Label>
                <Input
                  id="cp-phone"
                  dir="ltr"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="05XXXXXXXX"
                  className="h-11"
                  value={phone}
                  maxLength={30}
                  disabled={busy}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("portal.phone_hint")}</p>
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            {result ? (
              <Button onClick={() => setSending(false)}>{t("portal.done")}</Button>
            ) : (
              <>
                <Button variant="outline" disabled={busy} onClick={() => setSending(false)}>
                  {t("cancel")}
                </Button>
                <Button disabled={busy || name.trim().length < 2 || phone.trim().length < 5} onClick={send}>
                  {busy ? <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" /> : <Link2 size={15} className="me-1.5" aria-hidden="true" />}
                  {t("portal.send_submit")}
                </Button>
              </>
            )}
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
              <KeyValueRow label={t("portal.k_never")} value={t("portal.v_never")} />
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
                        <p className="text-xs text-muted-foreground" dir="auto">
                          {x.title}
                        </p>
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
