"use client"

// Admin → one contractor's package (WF-22): their needs suggest a package, the connector cards and the shortcuts set it,
// the pipeline shows it, and «ما يتغيّر عند الحفظ» says what it does to their records before anything is saved.
// The contractor's portal is never opened from here: the counts are the admin's view (impersonation is not built). «اعرض كما
// يراها» (AD-01) opens a read-only preview of the SAVED package instead — disabled while a change is unsaved, as the prototype.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { ArrowRight, Check, Eye, Layers, Loader2, NotebookPen, Send } from "lucide-react"
import { Link } from "@/i18n/routing"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Chip } from "@/components/module-ui/Chip"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { COMPANY_MODULES, forcedOffBy, offSet, type OptionalModule } from "@/lib/company-modules"
import { CONNECTORS, PRESETS, offFor, packageLabel, packageOf, samePackage, type Connector, type PackageFlags } from "@/lib/procurement/package"
import { impactQuiet, readImpactReport, type ImpactReport } from "@/lib/procurement/package-impact-report"
import { SUBSCRIPTION_STATUSES, subscriptionStatusOf, type SubscriptionStatus } from "@/lib/subscription-status"
import { cn } from "@/lib/utils"
import { ConnectorCard } from "./ConnectorCard"
import { ImpactPanel } from "./ImpactPanel"
import { NeedQuestions, type NeedAnswers } from "./NeedQuestions"
import { PackageChips } from "./PackageIcons"
import { PackagePipeline } from "./PackagePipeline"
import { SubscriptionStatusPill } from "./SubscriptionStatusPill"

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

const answerOf = (raw: unknown): 0 | 1 | null => (raw === 1 || raw === 0 ? raw : null)

const readNeeds = (raw: unknown): NeedAnswers => {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return { pm: answerOf(o.pm), fin: answerOf(o.fin), mfg: answerOf(o.mfg) }
}

const sinceOf = (v: unknown, locale: string): string => {
  const ts = v as { toDate?: () => Date } | string | null | undefined
  const date = typeof ts === "string" ? new Date(ts) : ts && typeof ts.toDate === "function" ? ts.toDate() : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(locale === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { year: "numeric", month: "short", day: "numeric" }) : ""
}

interface OwnerDoc {
  name?: string
  city?: string
  joinedAt?: unknown
  isVerified?: boolean
  verificationRequested?: boolean
}

export function ContractorPackagePage({ orgId }: { orgId: string }) {
  const t = useTranslations("Portal.AdminPackages.detail")
  const tp = useTranslations("Portal.ProcPackage")
  const tc = useTranslations("Portal.Admin.Contractors")
  const tSide = useTranslations("Portal.Sidebar")
  const tMod = useTranslations("Portal.AdminModules")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const ownerRef = useMemoFirebase(() => (firestore ? doc(firestore, "users", orgId) : null), [firestore, orgId])
  const modulesRef = useMemoFirebase(() => (firestore ? doc(firestore, COMPANY_MODULES, orgId) : null), [firestore, orgId])
  const { data: owner, isLoading: ownerLoading } = useDoc(ownerRef)
  const { data: stored, isLoading: modulesLoading } = useDoc(modulesRef)

  const storedOff = useMemo(() => [...offSet(stored as { off?: unknown } | null, "contractor")].sort(), [stored])
  const storedNeeds = useMemo(() => readNeeds((stored as { needs?: unknown } | null)?.needs), [stored])
  const storedSubscription = subscriptionStatusOf((stored as { subscription?: unknown } | null)?.subscription)

  const [draftOff, setDraftOff] = useState<string[] | null>(null)
  const [draftNeeds, setDraftNeeds] = useState<NeedAnswers | null>(null)
  const [draftSubscription, setDraftSubscription] = useState<SubscriptionStatus | null>(null)
  const [report, setReport] = useState<ImpactReport | null>(null)
  const [loadingImpact, setLoadingImpact] = useState(false)
  const [failedImpact, setFailedImpact] = useState(false)
  const [retry, setRetry] = useState(0)
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)

  const off = draftOff ?? storedOff
  const needs = draftNeeds ?? storedNeeds
  const pkg = packageOf(off)
  const before = packageOf(storedOff)
  const changed = CONNECTORS.filter((c) => pkg[c] !== before[c]).map((c) => ({ conn: c, to: (pkg[c] ? "on" : "off") as "on" | "off" }))
  const needsChanged = JSON.stringify(needs) !== JSON.stringify(storedNeeds)
  const subscription = draftSubscription ?? storedSubscription
  const subscriptionChanged = subscription !== storedSubscription
  const dirty = changed.length > 0 || needsChanged || subscriptionChanged || !sameList(off, storedOff)
  const offKey = off.join(",")
  const changedKey = changed.map((c) => `${c.conn}:${c.to}`).join("|")

  useEffect(() => {
    setReport(null)
    setAck(false)
    setFailedImpact(false)
    if (!user || changedKey === "") {
      setLoadingImpact(false)
      return
    }
    let cancelled = false
    setLoadingImpact(true)
    const timer = window.setTimeout(async () => {
      try {
        const token = await user.getIdToken()
        const res = await fetch(`/api/admin/company-modules/impact?orgId=${encodeURIComponent(orgId)}&off=${encodeURIComponent(offKey)}`, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error(`impact ${res.status}`)
        const body = (await res.json()) as { data?: unknown }
        if (!cancelled) setReport(readImpactReport(body.data))
      } catch {
        if (!cancelled) setFailedImpact(true)
      } finally {
        if (!cancelled) setLoadingImpact(false)
      }
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [user, orgId, offKey, changedKey, retry])

  const setConnector = useCallback((conn: Connector, on: boolean) => setDraftOff(offFor({ ...packageOf(off), [conn]: on }, off).sort()), [off])
  const setHr = (on: boolean) => {
    const next = new Set(off.filter((id) => id !== "hr"))
    if (!on) next.add("hr")
    setDraftOff([...offSet({ off: [...next] }, "contractor")].sort())
  }
  const applyPreset = (target: PackageFlags) => setDraftOff(offFor(target, off).sort())
  const answer = (conn: Connector, value: 0 | 1) => setDraftNeeds({ ...needs, [conn]: value })
  const undo = () => {
    setDraftOff(null)
    setDraftNeeds(null)
    setDraftSubscription(null)
  }

  const hrOn = !off.includes("hr")
  const hrForcedBy = forcedOffBy("hr", new Set(off) as ReadonlySet<OptionalModule>, "contractor")
  const needsAck = report ? !impactQuiet(report) : false
  const canSave = dirty && !busy && !loadingImpact && !failedImpact && (changed.length === 0 || report !== null) && (!needsAck || ack)

  const save = async () => {
    if (!user || !canSave) return
    setBusy(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch("/api/admin/company-modules", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId, off, needs, ack: needsAck ? ack : undefined, ...(subscriptionChanged ? { subscription } : {}) }),
      })
      const body = (await res.json().catch(() => null)) as { code?: string } | null
      if (!res.ok) {
        toast({ title: t(body?.code === "ACK_REQUIRED" ? "toast.ack_required" : "toast.failed"), variant: "destructive" })
        return
      }
      toast({ title: t("toast.saved", { name: String((owner as OwnerDoc | null)?.name ?? ""), label: packageLabel(pkg, tp) }) })
      undo()
    } catch {
      toast({ title: t("toast.failed"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const ready = !ownerLoading && !modulesLoading
  const o = (owner ?? null) as OwnerDoc | null
  const labels = { core: tp("base.core.short"), inv: tp("base.inv.short"), pm: tp("conn.pm.short"), fin: tp("conn.fin.short"), mfg: tp("conn.mfg.short") }
  const since = sinceOf(o?.joinedAt, locale)

  return (
    <PortalLayout>
      <div className="space-y-5 pb-24 text-start">
        <Link href="/admin/contractors" className="inline-flex items-center gap-1.5 text-sm font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowRight size={14} className="rtl:rotate-0 ltr:rotate-180" aria-hidden="true" />
          {t("back")}
        </Link>

        {!ready ? (
          <div className="flex justify-center p-16">
            <Loader2 className="animate-spin text-primary" size={28} aria-hidden="true" />
          </div>
        ) : !o ? (
          <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">{t("not_found")}</p>
        ) : (
          <>
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h1 className="text-2xl font-black text-foreground">{o.name}</h1>
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {[o.city, since && t("since", { date: since })].filter(Boolean).join(" · ")}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold">{o.isVerified ? tc("status_active") : o.verificationRequested ? tc("status_pending") : tc("status_review")}</span>
                  <SubscriptionStatusPill status={storedSubscription} />
                  <PackageChips pkg={pkg} labels={labels} />
                </p>
              </div>
              {dirty ? (
                <div className="flex flex-col items-end gap-1">
                  <Button type="button" variant="outline" disabled className="gap-2">
                    <Eye size={15} aria-hidden="true" />
                    {t("preview")}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">{t("preview_dirty")}</span>
                </div>
              ) : (
                <Button asChild variant="outline" className="gap-2">
                  <Link href={`/admin/contractors/${orgId}/preview`}>
                    <Eye size={15} aria-hidden="true" />
                    {t("preview")}
                  </Link>
                </Button>
              )}
            </header>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
                <h2 className="flex items-center gap-2 text-sm font-black">
                  <NotebookPen size={15} aria-hidden="true" />
                  {t("needs.title")}
                </h2>
                <p className="text-xs text-muted-foreground">{t("needs.sub")}</p>
                <NeedQuestions answers={needs} onAnswer={answer} disabled={busy} />
              </section>

              <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
                <h2 className="flex items-center justify-between gap-2 text-sm font-black">
                  <span className="flex items-center gap-2">
                    <Layers size={15} aria-hidden="true" />
                    {t("pkg.title")}
                  </span>
                  <span className="text-xs font-bold text-module" data-testid="package-label">
                    {packageLabel(pkg, tp)}
                  </span>
                </h2>
                <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
                  <PackageChips pkg={{ pm: false, fin: false, mfg: false }} labels={labels} />
                  <div className="min-w-0 flex-1 text-xs">
                    <b className="block text-sm">{t("pkg.base")}</b>
                    <span className="text-muted-foreground">{t("pkg.base_desc")}</span>
                  </div>
                  <Switch checked disabled aria-label={t("pkg.base")} />
                </div>
                <div className="space-y-2">
                  {CONNECTORS.map((conn) => (
                    <ConnectorCard key={conn} conn={conn} on={pkg[conn]} answer={needs[conn]} onToggle={(on) => setConnector(conn, on)} disabled={busy} />
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
                  <div className="min-w-0 text-xs">
                    <b className="block text-sm">{t("hr.title")}</b>
                    <span className="text-muted-foreground">{hrForcedBy ? tMod("needs_off", { module: tSide("component_finance") }) : t("hr.desc")}</span>
                  </div>
                  <Switch checked={hrOn} onCheckedChange={setHr} aria-label={t("hr.title")} disabled={busy || hrForcedBy !== null} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3" role="group" aria-label={t("subscription.label")}>
                  <div className="min-w-0 text-xs">
                    <b className="block text-sm">{t("subscription.label")}</b>
                    <span className="text-muted-foreground">{t("subscription.hint")}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {SUBSCRIPTION_STATUSES.map((s) => (
                      <Chip key={s} selected={subscription === s} disabled={busy} onClick={() => setDraftSubscription(s)}>
                        {t(`subscription.${s}`)}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <small className="text-xs font-bold text-muted-foreground">{t("pkg.shortcuts")}</small>
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={busy}
                      aria-pressed={samePackage(pkg, p.pkg)}
                      onClick={() => applyPreset(p.pkg)}
                      className={cn(
                        "min-h-9 rounded-full border px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        samePackage(pkg, p.pkg) ? "border-module bg-module/10 text-module" : "bg-card text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {tp(`preset.${p.id}`)}
                    </button>
                  ))}
                  <span className="basis-full text-[11px] text-muted-foreground">{t("pkg.provisional")}</span>
                </div>
              </section>
            </div>

            <section className="rounded-2xl border bg-card p-4 shadow-sm">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-black">
                <Send size={15} aria-hidden="true" />
                {t("pipeline.title")}
              </h2>
              <p className="mb-3 text-xs text-muted-foreground">{t("pipeline.sub")}</p>
              <PackagePipeline pkg={pkg} />
            </section>

            <ImpactPanel report={report} loading={loadingImpact} failed={failedImpact} acknowledged={ack} onAcknowledge={setAck} onRetry={() => setRetry((n) => n + 1)} changed={changed} />

            <div className="sticky bottom-0 z-30 -mx-2 flex flex-wrap items-center gap-3 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur" data-testid="package-bar">
              <span className="flex-1 text-sm text-muted-foreground">{dirty ? t("bar.unsaved", { count: Math.max(changed.length, 1) }) : t("bar.saved")}</span>
              {dirty && (
                <Button type="button" variant="outline" onClick={undo} disabled={busy}>
                  {t("bar.undo")}
                </Button>
              )}
              <Button type="button" onClick={() => void save()} disabled={!canSave} className="gap-2">
                {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
                {busy ? t("bar.saving") : t("bar.save")}
              </Button>
            </div>
          </>
        )}
      </div>
    </PortalLayout>
  )
}
