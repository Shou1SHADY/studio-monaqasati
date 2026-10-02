"use client"

// What a project waits on from other modules (the PM 1.0 prototype's «معلّق
// عند غيرنا»): Procurement's open orders and the approved material requests it
// has not answered yet, Finance's certified certificates not yet in the books
// and retention a handover made claimable, and — on the portfolio — handover
// files CRM has not completed since we returned them. No action button: the act
// is theirs. Only what has waited past its time is listed; the rest is counted
// behind "show all". A row opens where the thing sits. Given one project it
// reads that project's records; given several it names the project on each row,
// and takes each project's request / store rows and collectable certificates
// from the caller, which already reads them per project.

import { ShowMoreRow } from "@/components/module-ui/ShowMoreRow"
import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { CheckCircle2, Clock, Link2 } from "lucide-react"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { Link } from "@/i18n/routing"
import { JOURNAL_ENTRIES } from "@/lib/accounting/journal"
import { isAccountingEnabled } from "@/lib/accounting/post"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import { PM_EVENTS, type PmEvent } from "@/lib/pm/events"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { openReturns, PM_HANDOVERS, type PmHandover } from "@/lib/pm/handover"
import { crmWaitRows, financeWaitRows, poWaitRows, requestWaitRows, storeWaitRows, waitingView, WAIT_CAP, WAIT_LATE_DAYS, type WaitModule, type WaitRow } from "@/lib/pm/pulse"
import { PM_STORE, storeLineOf, type PmStoreLine } from "@/lib/pm/store"
import { PURCHASE_REQUESTS, requestOf } from "@/lib/pm/supply"
import { displayPoNumber } from "@/lib/procurement/format"
import { poStatus } from "@/lib/procurement/po"
import { PURCHASE_ORDERS, type PurchaseOrder } from "@/lib/procurement/types"
import type { PortalComponentId } from "@/lib/portal-components"
import { cn } from "@/lib/utils"

const MODULE: Record<WaitModule, PortalComponentId> = { proc: "procurement", fin: "payments", inv: "warehouses", crm: "crm" }

export function WaitingOnOthers({
  organizationId,
  projects,
  finance = false,
  money = false,
  crm = null,
  onOpenTab,
  extra,
  openCerts,
  cap = WAIT_CAP,
}: {
  organizationId: string
  projects: Array<{ id: string; name?: string; retentionReleased?: boolean }>
  /** The viewer holds the client side (`client`): Finance's rows are theirs to follow. */
  finance?: boolean
  /** Amounts only for money holders. */
  money?: boolean
  /** The portfolio, for a manager who approves: returned handover files CRM owes. */
  crm?: { uid: string | null; owner: boolean } | null
  /** On a project page: open one of its tabs in place. */
  onOpenTab?: (tab: string) => void
  /** Several projects: their request and store rows, built per project by the caller. */
  extra?: WaitRow[]
  /** Several projects: certificates still collectable (`projectId:seq`), read per project by the caller. */
  openCerts?: ReadonlySet<string>
  cap?: number
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const [showAll, setShowAll] = useState(false)
  const single = projects.length === 1 ? projects[0].id : null
  const today = todayDay()

  const poQ = useMemoFirebase(
    () =>
      firestore && organizationId
        ? single
          ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", organizationId), where("projectId", "==", single))
          : query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", organizationId))
        : null,
    [firestore, organizationId, single]
  )
  const { data: poData } = useCollection(poQ)
  const reqQ = useMemoFirebase(() => (firestore && single ? collection(firestore, "projects", single, PURCHASE_REQUESTS) : null), [firestore, single])
  const { data: reqData } = useCollection(reqQ)
  const storeQ = useMemoFirebase(() => (firestore && single ? collection(firestore, "projects", single, PM_STORE) : null), [firestore, single])
  const { data: storeData } = useCollection(storeQ)
  const [booksOn, setBooksOn] = useState(false)
  useEffect(() => {
    if (!firestore || !organizationId || !finance) return
    void isAccountingEnabled(firestore, organizationId).then(setBooksOn).catch(() => setBooksOn(false))
  }, [firestore, organizationId, finance])
  // Finance's rows show with Accounting off too: the events still go out, and
  // the certificate's own state says whether it still waits (it is read for that).
  const evQ = useMemoFirebase(
    () =>
      firestore && organizationId && finance
        ? single
          ? query(collection(firestore, PM_EVENTS), where("organizationId", "==", organizationId), where("projectId", "==", single))
          : query(collection(firestore, PM_EVENTS), where("organizationId", "==", organizationId))
        : null,
    [firestore, organizationId, finance, single]
  )
  const { data: evData } = useCollection(evQ)
  const certQ = useMemoFirebase(() => (firestore && single && finance && money && !booksOn ? collection(firestore, "projects", single, PM_CERTIFICATES) : null), [firestore, single, finance, money, booksOn])
  const { data: certData } = useCollection(certQ)
  const jQ = useMemoFirebase(
    () => (firestore && organizationId && finance && booksOn ? query(collection(firestore, JOURNAL_ENTRIES), where("organizationId", "==", organizationId), where("sourceType", "in", ["ipc_claim", "retention_release"])) : null),
    [firestore, organizationId, finance, booksOn]
  )
  const { data: jData } = useCollection(jQ)
  const crmOn = Boolean(crm)
  const hoQ = useMemoFirebase(() => (firestore && organizationId && crmOn ? query(collection(firestore, PM_HANDOVERS), where("organizationId", "==", organizationId)) : null), [firestore, organizationId, crmOn])
  const { data: hoData } = useCollection(hoQ)

  const nameOf = useMemo(() => new Map(projects.map((p) => [p.id, p.name || ""])), [projects])
  const rows = useMemo(() => {
    const out: WaitRow[] = []
    const pos = ((poData ?? []) as unknown as PurchaseOrder[])
      .filter((po) => po.projectId && nameOf.has(po.projectId))
      .map((po) => ({ ...po, lines: po.lines || [], log: po.log || [] }))
      .filter((po) => !["received", "closed", "cancelled"].includes(poStatus(po)))
    out.push(...poWaitRows(pos.map((po) => ({ ...po, docNumber: displayPoNumber(po.docNumber, locale) })), today))
    if (single) out.push(...requestWaitRows(((reqData ?? []) as Array<Record<string, unknown> & { id: string }>).map(requestOf), single, today))
    if (single) out.push(...storeWaitRows(((storeData ?? []) as Array<Partial<PmStoreLine> & { id: string }>).map((d) => storeLineOf(d.id, d)), single, today))
    if (!single && extra) out.push(...extra.filter((r) => r.projectId && nameOf.has(r.projectId)))
    if (finance && (booksOn || single || openCerts)) {
      const events = ((evData ?? []) as unknown as PmEvent[]).filter((e) => nameOf.has(e.projectId))
      const posted = new Set(((jData ?? []) as Array<{ sourceId?: string }>).map((e) => e.sourceId || ""))
      const released = new Set(projects.filter((p) => p.retentionReleased).map((p) => p.id))
      const open = booksOn
        ? undefined
        : single
          ? new Set(((certData ?? []) as Array<{ seq?: number; status?: string }>).filter((c) => c.status === "appr" || c.status === "part").map((c) => `${single}:${c.seq ?? 0}`))
          : openCerts
      out.push(...financeWaitRows({ events, posted, released, open, booksOff: !booksOn, today }))
    }
    if (crm) {
      const files = openReturns((hoData ?? []) as unknown as PmHandover[]).filter((h) => crm.owner || h.to === crm.uid)
      out.push(...crmWaitRows(files, today))
    }
    return out
  }, [poData, reqData, storeData, evData, jData, certData, hoData, nameOf, projects, single, finance, booksOn, crm, extra, openCerts, locale, today])

  if (!rows.length) return null
  const view = waitingView(rows, showAll, cap)

  const title = (r: WaitRow) => {
    if (r.kind === "retention") return t(`wait.retention_${r.params.stage}`)
    if (r.kind === "cert_invoice") return t("wait.cert_invoice", { no: t("ipc.no", { no: String(r.params.no) }) })
    return t(`wait.${r.kind}`, r.params)
  }
  const sub = (r: WaitRow) => {
    const p = r.sub.params
    const text = r.sub.kind === "po_promised" || r.sub.kind === "sent_on" || r.sub.kind === "books_off" ? t(`wait.sub.${r.sub.kind}`, { ...p, date: pmDate(String(p.date), locale) }) : t(`wait.sub.${r.sub.kind}`, p)
    const project = !single && r.projectId ? nameOf.get(r.projectId) : null
    return project ? `${project} · ${text}` : text
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-foreground">
          <Link2 size={16} className="shrink-0 text-module" aria-hidden="true" />
          {t("pulse.waiting_title")}
        </h3>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", view.late ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")}>
          {showAll ? view.total : view.late || view.total}
        </span>
        <span className="text-xs text-muted-foreground">{t("wait.desc")}</span>
      </header>
      {view.shown.length ? (
        <ul className="divide-y">
          {view.shown.map((r) => {
            const body = (
              <>
                <SourceBadge module={MODULE[r.module]} label={t(`wait.src.${r.module}`)} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[13px] font-bold text-foreground" dir="auto">
                    {title(r)}
                  </b>
                  <span className="block truncate text-xs text-muted-foreground" dir="auto">
                    {sub(r)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {money && r.amount ? (
                    <b className="text-xs font-bold tabular-nums" dir="ltr">
                      {pmMoney(r.amount)}
                    </b>
                  ) : null}
                  {r.age > 0 && (
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", r.age > 14 ? "bg-destructive/10 text-destructive" : r.age >= WAIT_LATE_DAYS ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")}>
                      <Clock size={11} aria-hidden="true" />
                      {t("days", { count: r.age })}
                    </span>
                  )}
                </span>
              </>
            )
            const cls = "flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            const href = r.href ?? (r.tab && r.projectId && !(single && onOpenTab) ? `/contractor/projects/${r.projectId}?tab=${r.tab}` : null)
            return (
              <li key={r.id}>
                {href ? (
                  <Link href={href} className={cls}>
                    {body}
                  </Link>
                ) : r.tab && onOpenTab ? (
                  <button type="button" onClick={() => onOpenTab(r.tab as string)} className={cls}>
                    {body}
                  </button>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="flex items-center gap-1.5 px-4 py-3 text-xs text-muted-foreground">
          <CheckCircle2 size={13} className="text-success" aria-hidden="true" />
          {t("wait.none_late", { count: view.total, days: WAIT_LATE_DAYS })}
        </p>
      )}
      {view.more && (
        <ShowMoreRow onClick={() => setShowAll(true)}>
          {t("wait.show_all", { count: view.total, by: view.byModule.map((m) => `${t(`wait.src.${m.module}`)} ${m.count}`).join(" · ") })}
        </ShowMoreRow>
      )}
    </section>
  )
}
