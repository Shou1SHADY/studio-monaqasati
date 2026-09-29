"use client"

// Execution › Subcontractors on a PM 1.0 project (WF-11, WF-12, SC-01…03): the
// summary per subcontractor, the registered contracts, the custody
// reconciliation, and the sub certificates. Amounts show only to `money`
// holders; the site engineer sees scope and progress. Paid is Finance's figure.
// Custody comes from the project store ledger (issue / return / count moves with
// his party key); custody lines recorded before the ledger still show, marked.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Boxes, Check, CheckCheck, ClipboardList, FileText, Loader2, Plus, Search, Undo2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useSupplyWorld } from "@/hooks/useSupplyWorld"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate, pmMoney, pmPct, todayDay } from "@/lib/pm/format"
import { matchesSearch } from "@/lib/search-text"
import {
  custodyFigures,
  custodyNo,
  DEFAULT_SUB_RETENTION,
  freeQty,
  letQty,
  lineCap,
  lineKey,
  ledgerCustodyRows,
  ledgerRecoveryDue,
  moveBlocks,
  pmApprovalLimit,
  rateVsEstimate,
  subEstimate,
  PM_SUB_CERTIFICATES,
  PM_SUB_CUSTODY,
  PM_SUBCONTRACTS,
  recoveryAmount,
  recoveryBlocks,
  recoveryDue,
  subApproveRefusal,
  subCertBlocks,
  subCertificateAmounts,
  subCertificateLines,
  subCertificateNo,
  subcontractBlocks,
  subcontractNo,
  subcontractValue,
  subSummaries,
  subTotals,
  type LedgerCustodyRow,
  type PmSubcontract,
  type PmSubCertificate,
  type PmSubCustody,
} from "@/lib/pm/subcontract"
import type { PmStoreLine } from "@/lib/pm/store"
import {
  approveSubCertificate,
  PmSubError,
  prepareSubCertificate,
  recordCustodyMove,
  recordRecovery,
  registerSubcontract,
  type SubActor,
} from "@/lib/pm/subcontract-writes"
import type { PmAttachment } from "@/lib/pm/attachments"
import { cn } from "@/lib/utils"
import { AttachmentTag, PmFilesField } from "./PmAttachments"
import { SubStoreMoveDialog, SubStoreRecoverDialog } from "./SubCustodyDialogs"

export interface SubItem {
  id: string
  code: string
  description: string
  unit: string
  quantity: number
  executed: number
  division: string
  /** Our estimated unit cost (`boqItems.estCost`), when the item has one. */
  estCost?: number
}

type SupplierDoc = { id: string; companyName?: string; name?: string; email?: string }

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s))
const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US")

export function SubcontractorsPanel({ projectId, orgId, items, access, actor }: { projectId: string; orgId?: string | null; items: SubItem[]; access: PmAccess; actor: SubActor }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<null | "register" | "cert">(null)
  const [moveOf, setMoveOf] = useState<{ c: PmSubCustody; t: "iss" | "back" | "cnt" } | null>(null)
  const [recoverOf, setRecoverOf] = useState<PmSubCustody | null>(null)
  const [ledMove, setLedMove] = useState<{ t: "iss" | "back" | "cnt"; storeId?: string; partyKey?: string } | null>(null)
  const [ledRecover, setLedRecover] = useState<LedgerCustodyRow | null>(null)
  const world = useSupplyWorld(projectId, orgId)

  const cq = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_SUBCONTRACTS) : null), [firestore, projectId])
  const sq = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_SUB_CERTIFICATES) : null), [firestore, projectId])
  const kq = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_SUB_CUSTODY) : null), [firestore, projectId])
  const { data: cData } = useCollection(cq)
  const { data: sData } = useCollection(sq)
  const { data: kData } = useCollection(kq)
  const contracts = useMemo(() => ((cData ?? []) as unknown as PmSubcontract[]).slice().sort((a, b) => b.seq - a.seq), [cData])
  const certs = useMemo(() => ((sData ?? []) as unknown as PmSubCertificate[]).slice().sort((a, b) => b.seq - a.seq), [sData])
  const custody = useMemo(() => ((kData ?? []) as unknown as PmSubCustody[]).slice().sort((a, b) => a.seq - b.seq), [kData])

  const money = access.has("money")
  const canSub = !access.ctx.archived && access.allowed("subcontract.manage")
  const canStore = !access.ctx.archived && access.allowed("store.move")
  // The count and the recovery are the approver's (the prototype's CAN('approve')); issuing and returning are the store's.
  const canReconcile = !access.ctx.archived && access.allowed("reconciliation.manage")
  const limit = pmApprovalLimit(access.ctx.ceiling)
  const rows = useMemo(() => subSummaries(contracts), [contracts])
  const totals = subTotals(rows)
  const itemOf = (id: string) => items.find((i) => i.id === id)
  const itemName = (id: string, code?: string | null) => {
    const i = itemOf(id)
    return i ? i.description || i.code : code || id
  }

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    if (!firestore) return false
    setBusy(key)
    try {
      await fn()
      toast({ title: ok })
      return true
    } catch (err) {
      console.error(err)
      const title =
        err instanceof PmAccessError
          ? t(`refused.${err.code}`)
          : err instanceof PmSubError
            ? err.blocks[0]
              ? t(`subs.block.${err.blocks[0]}`)
              : t(`subs.err.${err.code}`)
            : t("error.save")
      toast({ title, variant: "destructive" })
      return false
    } finally {
      setBusy(null)
    }
  }

  const registerBtn = canSub ? (
    <Button size="sm" onClick={() => setDialog("register")}>
      <Plus size={15} className="me-1.5" aria-hidden="true" />
      {t("subs.register")}
    </Button>
  ) : null

  if (contracts.length === 0) {
    return (
      <>
        <Panel title={t("subs.title")} icon={Users} actions={registerBtn}>
          <EmptyState icon={Users} title={t("subs.empty")} description={t("subs.empty_desc")} />
        </Panel>
        {dialog === "register" && firestore && (
          <RegisterDialog projectId={projectId} orgId={orgId} items={items} contracts={contracts} money={money} limit={limit} busy={busy} onClose={() => setDialog(null)} onSave={(input) => run("register", () => registerSubcontract(firestore, access.ctx, projectId, actor, input), t("subs.registered"))} />
        )}
      </>
    )
  }

  const gapRows = custody.map((c) => ({ c, f: custodyFigures(c, itemOf(c.itemId)?.executed ?? c.executedAtStart) }))
  const ledRows = ledgerCustodyRows(world.stores, items, contracts, (x) => world.costOf(x))
  const bad = gapRows.filter((r) => r.f.gap !== null && r.f.gap > 0.005).length + ledRows.filter((r) => r.gap !== null && r.gap > 0.005).length
  const due = rows.map((r) => ({ r, v: recoveryDue(custody, r.partyKey) + ledgerRecoveryDue(world.stores, r.partyKey) })).filter((x) => x.v > 0)

  return (
    <div className="space-y-4">
      <Panel title={t("subs.title")} icon={Users} actions={registerBtn} bodyClassName="p-0">
        <p className="px-4 pt-3 text-xs text-muted-foreground">{t("subs.owned")}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-2 text-start font-semibold">{t("subs.col.sub")}</th>
                <th className="px-4 py-2 text-start font-semibold">{t("subs.col.scope")}</th>
                <th className="px-4 py-2 text-start font-semibold">{t("subs.col.progress")}</th>
                {money && (
                  <>
                    <th className="px-4 py-2 text-end font-semibold">{t("subs.col.contract")}</th>
                    <th className="px-4 py-2 text-end font-semibold">{t("subs.col.certified")}</th>
                    <th className="px-4 py-2 text-end font-semibold">{t("subs.col.paid")}</th>
                    <th className="px-4 py-2 text-end font-semibold">{t("subs.col.retention")}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const scope = [...new Set(r.itemIds.map((id) => itemOf(id)?.division).filter((d): d is string => Boolean(d)))]
                return (
                  <tr key={r.partyKey} className="border-b last:border-0">
                    <td className="px-4 py-2.5">
                      <p className="font-bold" dir="auto">
                        {r.party.name}
                      </p>
                      <p className="text-xs text-muted-foreground">{t("subs.items", { count: r.itemIds.length })}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground" dir="auto">
                      {scope.join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex min-w-[120px] items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(r.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={t("subs.col.progress")}>
                          <div className={cn("h-full rounded-full", r.progress >= 0.99 ? "bg-success" : "bg-module")} style={{ width: `${Math.min(100, r.progress * 100)}%` }} />
                        </div>
                        <span className="text-xs tabular-nums" dir="ltr">
                          {pmPct(r.progress)}
                        </span>
                      </div>
                    </td>
                    {money && (
                      <>
                        <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">
                          {pmMoney(r.value)}
                        </td>
                        <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">
                          {pmMoney(r.certified)}
                        </td>
                        <td className="px-4 py-2.5 text-end">
                          <p className="tabular-nums" dir="ltr">
                            {pmMoney(r.paid)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("subs.due")} <span dir="ltr">{pmMoney(r.due)}</span>
                          </p>
                          <SourceBadge module="payments" label={t("subs.finance")} className="mt-0.5" />
                        </td>
                        <td className="px-4 py-2.5 text-end tabular-nums" dir="ltr">
                          {pmMoney(r.retention)}
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {money && (
          <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
            {t("subs.totals", { total: pmMoney(totals.value), share: pmPct(totals.share), retention: pmMoney(totals.retention) })}
          </p>
        )}
      </Panel>

      <Panel title={t("subs.contracts")} icon={FileText} count={contracts.length}>
        <p className="mb-3 text-xs text-muted-foreground">{t("subs.contracts_sub")}</p>
        <ul className="space-y-2">
          {contracts.map((c) => (
            <li key={c.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold" dir="auto">
                    {t("subs.contract_no", { no: subcontractNo(c.seq) })} — {c.party.name}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.lines
                      .slice(0, 4)
                      .map((l) => l.code || itemName(l.itemId))
                      .join(" · ")}
                    {c.lines.length > 4 ? ` +${c.lines.length - 4}` : ""} · {t("subs.registered_on", { date: pmDate(c.on, locale) })}
                    {c.byName ? ` · ${c.byName}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.endOn ? t("subs.dates", { from: pmDate(c.startOn, locale), to: pmDate(c.endOn, locale) }) : t("subs.dates_open", { from: pmDate(c.startOn, locale) })}
                  </p>
                  {c.note && (
                    <p className="mt-0.5 text-xs" dir="auto">
                      {c.note}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <AttachmentTag files={c.files} />
                  <StatusPill tone="mute">{t("subs.retention_pill", { rate: pmPct(c.retention) })}</StatusPill>
                  {money && (
                    <b className="text-xs tabular-nums" dir="ltr">
                      {pmMoney(c.value)}
                    </b>
                  )}
                </div>
              </div>
              <ul className="mt-2 space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
                {c.lines.map((l, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-2">
                    <span dir="auto">
                      <span className="font-semibold text-foreground">{l.code}</span> {itemName(l.itemId, l.code)}
                    </span>
                    <span dir="ltr" className="tabular-nums">
                      {qty(l.qty)} {l.unit ?? ""}
                      {money ? ` × ${pmMoney(l.rate)} = ${pmMoney(l.value)}` : ""} · {pmPct(l.certified)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title={t("subs.recon.title")}
        icon={Boxes}
        count={gapRows.length + ledRows.length}
        actions={
          canStore ? (
            <Button size="sm" variant="outline" onClick={() => setLedMove({ t: "iss" })}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("subs.recon.issue")}
            </Button>
          ) : null
        }
        bodyClassName="p-0"
      >
        <p className={cn("px-4 pt-3 text-xs", bad ? "text-destructive" : "text-muted-foreground")}>{t("subs.recon.sub")}</p>
        {gapRows.length + ledRows.length === 0 ? (
          <div className="p-4">
            <EmptyState icon={Boxes} title={t("subs.recon.empty")} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-start font-semibold">{t("subs.recon.col.who")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("subs.recon.col.issued")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("subs.recon.col.theo")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("subs.recon.col.allowed")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("subs.recon.col.book")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("subs.recon.col.count")}</th>
                  <th className="px-3 py-2 text-center font-semibold">{t("subs.recon.col.gap")}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {ledRows.map((r) => {
                  const short = r.gap !== null && r.gap > 0.005
                  return (
                    <tr key={`${r.storeId}:${r.partyKey}`} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <p className="font-bold" dir="auto">
                          {r.name}
                        </p>
                        <p className="text-xs text-muted-foreground" dir="auto">
                          {r.line.name} · {r.line.unit}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums" dir="ltr">
                        {qty(r.issued)}
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums" dir="ltr">
                        {qty(r.theoretical)}
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums" dir="ltr">
                        {qty(r.allowed)}
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums" dir="ltr">
                        {qty(r.book)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {r.count ? (
                          <>
                            <span className="tabular-nums" dir="ltr">
                              {qty(r.count.q)}
                            </span>
                            <p className="text-xs text-muted-foreground">{pmDate(r.count.on, locale)}</p>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={cn("px-3 py-2.5 text-center text-xs font-semibold", r.gap === null ? "text-muted-foreground" : short ? "text-destructive" : "text-success")}>
                        {r.gap === null ? (
                          t("subs.recon.needs_count")
                        ) : short ? (
                          <>
                            <span dir="ltr">−{qty(r.gap)}</span>
                            {money && r.gapValue > 0 && (
                              <p className="font-normal" dir="ltr">
                                {pmMoney(r.gapValue)}
                              </p>
                            )}
                          </>
                        ) : (
                          t("subs.recon.matched")
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {canReconcile && (
                            <Button size="sm" variant="outline" onClick={() => setLedMove({ t: "cnt", storeId: r.storeId, partyKey: r.partyKey })}>
                              {r.count ? t("subs.recon.recount") : t("subs.recon.count")}
                            </Button>
                          )}
                          {canStore && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setLedMove({ t: "iss", storeId: r.storeId, partyKey: r.partyKey })} aria-label={t("subs.recon.issue_more")}>
                                <Plus size={14} aria-hidden="true" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setLedMove({ t: "back", storeId: r.storeId, partyKey: r.partyKey })} aria-label={t("subs.recon.return")} disabled={r.issued <= 0}>
                                <Undo2 size={14} aria-hidden="true" />
                              </Button>
                            </>
                          )}
                          {canReconcile && short && (
                            <Button size="sm" variant="destructive" onClick={() => setLedRecover(r)}>
                              {t("subs.recon.recover")}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {gapRows.map(({ c, f }) => {
                  const short = f.gap !== null && f.gap > 0.005
                  return (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <p className="font-bold" dir="auto">
                          {c.party.name}
                        </p>
                        <p className="text-xs text-muted-foreground" dir="auto">
                          {c.material} · {c.unit} · {c.code || itemName(c.itemId)}
                        </p>
                        <StatusPill tone="mute" className="mt-0.5">
                          {t("subs.led.earlier")}
                        </StatusPill>
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums" dir="ltr">
                        {qty(f.issued)}
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums" dir="ltr">
                        {qty(f.theoretical)}
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums" dir="ltr">
                        {qty(f.allowed)}
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums" dir="ltr">
                        {qty(f.book)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {f.count ? (
                          <>
                            <span className="tabular-nums" dir="ltr">
                              {qty(f.count.q)}
                            </span>
                            <p className="text-xs text-muted-foreground">{pmDate(f.count.day, locale)}</p>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={cn("px-3 py-2.5 text-center text-xs font-semibold", f.gap === null ? "text-muted-foreground" : short ? "text-destructive" : "text-success")}>
                        {f.gap === null ? (
                          t("subs.recon.needs_count")
                        ) : short ? (
                          <>
                            <span dir="ltr">−{qty(f.gap)}</span>
                            {money && (
                              <p className="font-normal" dir="ltr">
                                {pmMoney(f.gapValue)}
                              </p>
                            )}
                          </>
                        ) : (
                          t("subs.recon.matched")
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {canReconcile && (
                            <Button size="sm" variant="outline" onClick={() => setMoveOf({ c, t: "cnt" })}>
                              {f.count ? t("subs.recon.recount") : t("subs.recon.count")}
                            </Button>
                          )}
                          {canStore && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => setMoveOf({ c, t: "iss" })} aria-label={t("subs.recon.issue_more")}>
                                <Plus size={14} aria-hidden="true" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setMoveOf({ c, t: "back" })} aria-label={t("subs.recon.return")} disabled={f.issued <= 0}>
                                <Undo2 size={14} aria-hidden="true" />
                              </Button>
                            </>
                          )}
                          {canReconcile && short && (
                            <Button size="sm" variant="destructive" onClick={() => setRecoverOf(c)}>
                              {t("subs.recon.recover")}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{t("subs.recon.foot")}</p>
        {due.length > 0 && money && (
          <div className="px-4 pb-3">
            <Callout tone="warn" title={t("subs.recon.due_title")}>
              {due.map((d, i) => (
                <span key={d.r.partyKey}>
                  {i > 0 ? " · " : ""}
                  <span dir="auto">{d.r.party.name}</span> <span dir="ltr">{pmMoney(d.v)}</span>
                </span>
              ))}
            </Callout>
          </div>
        )}
      </Panel>

      <Panel
        title={t("subs.certs.title")}
        icon={ClipboardList}
        count={certs.filter((c) => c.status === "int").length || undefined}
        actions={
          canSub ? (
            <Button size="sm" onClick={() => setDialog("cert")}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("subs.certs.prepare")}
            </Button>
          ) : null
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">{t("subs.certs.sub")}</p>
        {certs.length === 0 ? (
          <EmptyState icon={ClipboardList} title={t("subs.certs.empty")} />
        ) : (
          <ul className="space-y-2">
            {certs.map((s) => {
              const refusal = subApproveRefusal({ archived: access.ctx.archived, ipcOk: access.has("ipcOk"), actorUid: access.uid ?? "", prep: s.prep, amount: s.gross, limit })
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold" dir="auto">
                      {t("subs.certs.no", { no: subCertificateNo(s.seq) })} — {s.party.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {pmDate(s.prepOn, locale)} · {t("subs.certs.prepared_by", { who: s.prepName || "—" })}
                      {s.appr ? ` · ${t("subs.certs.approved_by", { who: s.apprName || "—" })}` : ""}
                      {money ? ` · ${t("subs.certs.retention_line", { amount: pmMoney(s.retention) })}` : ""}
                      {money && s.recovery > 0 ? ` · ${t("subs.certs.recovery_line", { amount: pmMoney(s.recovery) })}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {money && (
                      <b className="tabular-nums" dir="ltr">
                        {pmMoney(s.gross)}
                      </b>
                    )}
                    <StatusPill tone={s.status === "ok" ? "ok" : "warn"}>{s.status === "ok" ? t("subs.certs.status.ok") : t("subs.certs.status.int")}</StatusPill>
                    {s.status === "int" &&
                      (refusal === null ? (
                        <Button
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => firestore && void run(`ok${s.seq}`, () => approveSubCertificate(firestore, access.ctx, projectId, actor, s.seq), t("subs.certs.approved", { no: subCertificateNo(s.seq) }))}
                        >
                          {busy === `ok${s.seq}` ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <Check size={14} className="me-1.5" aria-hidden="true" />}
                          {t("subs.certs.approve")}
                        </Button>
                      ) : refusal === "self_approval" ? (
                        <span className="text-xs text-muted-foreground">{t("subs.certs.you_prepared")}</span>
                      ) : refusal === "over_limit" ? (
                        <span className="text-xs text-muted-foreground">{t("subs.certs.over_limit", { limit: pmMoney(limit) })}</span>
                      ) : null)}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      {firestore && dialog === "register" && (
        <RegisterDialog projectId={projectId} orgId={orgId} items={items} contracts={contracts} money={money} limit={limit} busy={busy} onClose={() => setDialog(null)} onSave={(input) => run("register", () => registerSubcontract(firestore, access.ctx, projectId, actor, input), t("subs.registered"))} />
      )}
      {firestore && dialog === "cert" && (
        <CertDialog
          items={items}
          contracts={contracts}
          certs={certs}
          custody={custody}
          ledger={world.stores}
          money={money}
          busy={busy}
          archived={access.ctx.archived}
          onClose={() => setDialog(null)}
          onSave={(input) => run("cert", () => prepareSubCertificate(firestore, access.ctx, projectId, actor, input), t("subs.certs.prepared"))}
        />
      )}
      {firestore && moveOf && (
        <MoveDialog
          custody={moveOf.c}
          kind={moveOf.t}
          executed={itemOf(moveOf.c.itemId)?.executed ?? moveOf.c.executedAtStart}
          busy={busy}
          archived={access.ctx.archived}
          onClose={() => setMoveOf(null)}
          onSave={(input) => run("move", () => recordCustodyMove(firestore, access.ctx, projectId, actor, moveOf.c.seq, { ...input, t: moveOf.t }), t(`subs.recon.saved_${moveOf.t}`))}
        />
      )}
      {ledMove && (
        <SubStoreMoveDialog
          projectId={projectId}
          orgId={orgId}
          kind={ledMove.t}
          lines={world.stores}
          items={items}
          contracts={contracts}
          storeId={ledMove.storeId}
          partyKey={ledMove.partyKey}
          access={access}
          actor={actor}
          onClose={() => setLedMove(null)}
        />
      )}
      {ledRecover && (
        <SubStoreRecoverDialog
          projectId={projectId}
          line={ledRecover.line}
          partyKey={ledRecover.partyKey}
          name={ledRecover.name}
          gap={ledRecover.gap}
          unitCost={world.costOf(ledRecover.line)}
          money={money}
          access={access}
          actor={actor}
          onClose={() => setLedRecover(null)}
        />
      )}
      {firestore && recoverOf && (
        <RecoverDialog
          custody={recoverOf}
          executed={itemOf(recoverOf.itemId)?.executed ?? recoverOf.executedAtStart}
          money={money}
          busy={busy}
          archived={access.ctx.archived}
          onClose={() => setRecoverOf(null)}
          onSave={(input) => run("recover", () => recordRecovery(firestore, access.ctx, projectId, actor, recoverOf.seq, input), t("subs.recon.recovered", { name: recoverOf.party.name }))}
        />
      )}
    </div>
  )
}

type SaveFn<T> = (input: T) => Promise<boolean>

function Footer({ onClose, busy, disabled, onSave, label, tone }: { onClose: () => void; busy: boolean; disabled: boolean; onSave: () => void; label: string; tone?: "destructive" }) {
  const t = useTranslations("Portal.PM")
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onClose} disabled={busy}>
        {t("cancel")}
      </Button>
      <Button variant={tone ?? "default"} disabled={busy || disabled} onClick={onSave}>
        {busy ? <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" /> : <CheckCheck size={16} className="me-2" aria-hidden="true" />}
        {label}
      </Button>
    </DialogFooter>
  )
}

type Picked = Record<string, { q: string; r: string }>

function RegisterDialog({
  projectId,
  orgId,
  items,
  contracts,
  money,
  limit,
  busy,
  onClose,
  onSave,
}: {
  projectId: string
  orgId?: string | null
  items: SubItem[]
  contracts: PmSubcontract[]
  money: boolean
  limit: number
  busy: string | null
  onClose: () => void
  onSave: SaveFn<Parameters<typeof registerSubcontract>[4]>
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const [name, setName] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const [ret, setRet] = useState(String(DEFAULT_SUB_RETENTION))
  const [startOn, setStartOn] = useState(todayDay())
  const [endOn, setEndOn] = useState("")
  const [note, setNote] = useState("")
  const [picked, setPicked] = useState<Picked>({})
  const [search, setSearch] = useState("")
  const [files, setFiles] = useState<PmAttachment[]>([])

  const supQ = useMemoFirebase(() => (firestore ? query(collection(firestore, "users"), where("role", "==", "Supplier")) : null), [firestore])
  const { data: supData } = useCollection(supQ)
  const suppliers = ((supData ?? []) as unknown as SupplierDoc[]).map((s) => ({ id: s.id, label: s.companyName || s.name || s.email || s.id }))

  const free = (i: SubItem) => (i.quantity > 0 ? freeQty(i.quantity, letQty(contracts, i.id)) : null)
  const open = items.filter((i) => {
    const f = free(i)
    return f === null || f > 0.0005
  })
  const shown = open.filter((i) => picked[i.id] || matchesSearch(search, [i.code, i.description]))
  const lines = Object.entries(picked).map(([itemId, v]) => {
    const i = items.find((x) => x.id === itemId)
    return { itemId, qty: Number(v.q) || 0, rate: Number(v.r) || 0, free: i ? free(i) : null }
  })
  const value = subcontractValue(lines.filter((l) => l.qty > 0 && l.rate > 0))
  const est = subEstimate(lines.map((l) => ({ ...l, estCost: items.find((i) => i.id === l.itemId)?.estCost ?? 0 })))
  const retNum = num(ret)
  const blocks = subcontractBlocks({ archived: false, partyName: name, lines, retentionPct: retNum, startOn, endOn: endOn || null, limit })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("subs.form.title")}</DialogTitle>
          <DialogDescription>{t("subs.form.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("subs.form.supplier")}</Label>
              <SearchableSelect
                value={supplierId}
                onChange={(v) => {
                  setSupplierId(v)
                  const s = suppliers.find((x) => x.id === v)
                  if (s) setName(s.label)
                }}
                options={[{ value: "", label: t("subs.form.not_on_portal") }, ...suppliers.map((s) => ({ value: s.id, label: s.label }))]}
                placeholder={t("subs.form.not_on_portal")}
                searchPlaceholder={t("subs.form.search_supplier")}
                noResultsText={t("subs.form.no_supplier")}
                ariaLabel={t("subs.form.supplier")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-name">{t("subs.form.name")} *</Label>
              <Input id="sc-name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("subs.form.name_ph")} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sc-ret">{t("subs.form.retention")}</Label>
              <Input id="sc-ret" dir="ltr" type="number" min={0} max={20} step={0.5} value={ret} onChange={(e) => setRet(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("subs.form.retention_hint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-sd">{t("subs.form.start")}</Label>
              <Input id="sc-sd" dir="ltr" type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sc-ed">{t("subs.form.end")}</Label>
              <Input id="sc-ed" dir="ltr" type="date" value={endOn} onChange={(e) => setEndOn(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t("subs.form.scope")} *</Label>
            <p className="text-xs text-muted-foreground">{t("subs.form.scope_hint")}</p>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input className="ps-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("subs.form.search_item")} aria-label={t("subs.form.search_item")} />
            </div>
            <ul className="max-h-72 divide-y overflow-y-auto rounded-xl border">
              {shown.map((i) => {
                const on = picked[i.id]
                const f = free(i)
                const lineValue = on ? (Number(on.q) || 0) * (Number(on.r) || 0) : 0
                return (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-pressed={Boolean(on)}
                      onClick={() =>
                        setPicked((p) => {
                          const next = { ...p }
                          if (next[i.id]) delete next[i.id]
                          else next[i.id] = { q: f === null ? "" : String(f), r: "" }
                          return next
                        })
                      }
                    >
                      <p className="text-sm font-semibold" dir="auto">
                        {on ? "✓ " : ""}
                        {i.description || i.code}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-semibold">{i.code}</span> · {f === null ? t("subs.form.no_qty") : t("subs.form.free", { qty: qty(f), unit: i.unit })}
                      </p>
                    </button>
                    {on ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          className="h-8 w-24"
                          dir="ltr"
                          type="number"
                          min={0}
                          step={0.01}
                          value={on.q}
                          placeholder={f === null ? "" : qty(f)}
                          aria-label={t("subs.form.qty")}
                          onChange={(e) => setPicked((p) => ({ ...p, [i.id]: { ...p[i.id], q: e.target.value } }))}
                        />
                        <span className="text-xs text-muted-foreground">{i.unit} ×</span>
                        <Input
                          className="h-8 w-24"
                          dir="ltr"
                          type="number"
                          min={0}
                          step={0.5}
                          value={on.r}
                          placeholder={t("subs.form.rate")}
                          aria-label={t("subs.form.rate")}
                          onChange={(e) => setPicked((p) => ({ ...p, [i.id]: { ...p[i.id], r: e.target.value } }))}
                        />
                        {money && (
                          <span className="text-xs tabular-nums" dir="ltr">
                            {pmMoney(lineValue)}
                          </span>
                        )}
                        {money && (i.estCost ?? 0) > 0 && (
                          <span className="basis-full text-[11px] text-muted-foreground">
                            {t("subs.form.est_unit", { v: pmMoney(i.estCost ?? 0) })}
                            {(() => {
                              const d = rateVsEstimate(Number(on.r) || 0, i.estCost ?? 0)
                              return d === null ? null : (
                                <b className={cn("ms-1", d > 0 ? "text-destructive" : "text-success")}>{d > 0 ? t("subs.form.above_est", { pct: Math.round(d) }) : t("subs.form.below_est", { pct: Math.round(-d) })}</b>
                              )
                            })()}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("subs.form.tap")}</span>
                    )}
                  </li>
                )
              })}
              {shown.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted-foreground">{t("subs.form.no_items")}</li>}
            </ul>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sc-note">{t("subs.form.note")}</Label>
            <Input id="sc-note" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("subs.form.note_ph")} />
          </div>
          <PmFilesField orgId={orgId} folder={`projects/${projectId}/subcontracts`} value={files} onChange={setFiles} label={t("subs.form.signed")} hint={t("subs.form.signed_hint")} />
          {money && (
            <div className="rounded-xl border px-3">
              <KeyValueRow label={t("subs.form.value")} value={pmMoney(value)} ltr strong />
              {est.known > 0 && (
                <>
                  <KeyValueRow label={t("subs.form.est_scope")} value={pmMoney(est.estimate)} ltr />
                  <KeyValueRow
                    label={est.diff > 0 ? t("subs.form.eats_margin") : t("subs.form.adds_margin")}
                    value={<span className={est.diff > 0 ? "text-destructive" : "text-success"}>{pmMoney(Math.abs(est.diff))}</span>}
                    ltr
                  />
                </>
              )}
            </div>
          )}
          {blocks.includes("over_limit") ? (
            <Callout tone="block">{t("subs.form.over_limit", { value: pmMoney(value), limit: pmMoney(limit) })}</Callout>
          ) : null}
          <BlockingReasons title={t("cannot_save")} reasons={blocks.filter((b) => b !== "over_limit" && b !== "archived").map((b) => t(`subs.block.${b}`))} />
        </div>
        <Footer
          onClose={onClose}
          busy={busy !== null}
          disabled={blocks.length > 0}
          label={t("subs.form.save")}
          onSave={async () => {
            const ok = await onSave({ party: { name, supplierId: supplierId || null }, retentionPct: retNum, startOn, endOn: endOn || null, note: note || null, lines: lines.map(({ itemId, qty: q, rate }) => ({ itemId, qty: q, rate })), files })
            if (ok) onClose()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function CertDialog({
  items,
  contracts,
  certs,
  custody,
  ledger,
  money,
  busy,
  archived,
  onClose,
  onSave,
}: {
  items: SubItem[]
  contracts: PmSubcontract[]
  certs: PmSubCertificate[]
  custody: PmSubCustody[]
  ledger: Array<Pick<PmStoreLine, "recoveries">>
  money: boolean
  busy: string | null
  archived: boolean
  onClose: () => void
  onSave: SaveFn<Parameters<typeof prepareSubCertificate>[4]>
}) {
  const t = useTranslations("Portal.PM")
  const parties = subSummaries(contracts)
  const [key, setKey] = useState(parties[0]?.partyKey ?? "")
  const [pc, setPc] = useState<Record<string, string>>({})
  const mine = contracts.filter((c) => c.partyKey === key).sort((a, b) => a.seq - b.seq)
  const caps: Record<string, number> = {}
  mine.forEach((c) =>
    c.lines.forEach((l, i) => {
      const it = items.find((x) => x.id === l.itemId)
      caps[lineKey(c.seq, i)] = it ? lineCap({ executed: it.executed, itemQty: it.quantity, letQty: letQty(contracts, l.itemId) }) : 0
    })
  )
  const percents: Record<string, number> = {}
  Object.entries(pc).forEach(([k, v]) => {
    if (v.trim() !== "") percents[k] = Number(v)
  })
  const prepared = subCertificateLines(mine, percents, caps)
  const recovery = recoveryDue(custody, key) + ledgerRecoveryDue(ledger, key)
  const amounts = subCertificateAmounts(prepared.lines, recovery)
  const pending = certs.some((c) => c.partyKey === key && c.status === "int")
  const blocks = subCertBlocks({ archived, gross: amounts.gross, over: prepared.over.length, below: prepared.below.length, pending })
  const rates = [...new Set(mine.map((c) => c.retention))]

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("subs.certs.form_title")}</DialogTitle>
          <DialogDescription>{t("subs.certs.form_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("subs.col.sub")}</Label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("subs.col.sub")}>
              {parties.map((p) => (
                <button
                  key={p.partyKey}
                  type="button"
                  role="radio"
                  aria-checked={p.partyKey === key}
                  onClick={() => {
                    setKey(p.partyKey)
                    setPc({})
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    p.partyKey === key && "border-module bg-module/10 text-module"
                  )}
                  dir="auto"
                >
                  {p.party.name}
                </button>
              ))}
            </div>
          </div>
          <Callout tone="info">{t("subs.certs.cap_note")}</Callout>
          <ul className="divide-y rounded-xl border">
            {mine.flatMap((c) =>
              c.lines.map((l, i) => {
                const k = lineKey(c.seq, i)
                const over = prepared.over.includes(k)
                return (
                  <li key={k} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold" dir="auto">
                        {items.find((x) => x.id === l.itemId)?.description || l.description || l.code}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-semibold">{l.code}</span> · {t("subs.contract_no", { no: subcontractNo(c.seq) })}
                        {money ? ` · ${t("subs.certs.line_value", { amount: pmMoney(l.value) })}` : ""} · {t("subs.certs.so_far", { pct: pmPct(l.certified) })} ·{" "}
                        {t("subs.certs.measured", { pct: pmPct(caps[k]) })}
                      </p>
                      {over && <p className="text-xs font-bold text-destructive">{t("subs.certs.over_line")}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Input
                        className={cn("h-8 w-24", over && "border-destructive")}
                        dir="ltr"
                        type="number"
                        min={Math.round(l.certified * 10000) / 100}
                        max={100}
                        step={0.1}
                        value={pc[k] ?? ""}
                        placeholder={String(Math.round(l.certified * 1000) / 10)}
                        aria-label={t("subs.certs.cum_pct")}
                        aria-invalid={over}
                        onChange={(e) => setPc((p) => ({ ...p, [k]: e.target.value }))}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </li>
                )
              })
            )}
          </ul>
          {money && (
            <div className="rounded-xl border px-3">
              <KeyValueRow label={t("subs.certs.period_value")} value={pmMoney(amounts.gross)} ltr />
              <KeyValueRow label={t("subs.certs.retention", { rate: rates.map((r) => pmPct(r)).join(" / ") || "—" })} value={`−${pmMoney(amounts.retention)}`} ltr />
              {amounts.recovery > 0 && <KeyValueRow label={t("subs.certs.recovery")} value={`−${pmMoney(amounts.recovery)}`} ltr />}
              <KeyValueRow label={t("subs.certs.net")} value={pmMoney(amounts.net)} ltr strong />
            </div>
          )}
          {amounts.recovery > 0 && <Callout tone="warn">{t("subs.certs.recovery_note")}</Callout>}
          <Callout tone="info">{t("subs.certs.two_people")}</Callout>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.filter((b) => b !== "archived").map((b) => t(`subs.block.${b}`))} />
        </div>
        <Footer
          onClose={onClose}
          busy={busy !== null}
          disabled={blocks.length > 0}
          label={t("subs.certs.save")}
          onSave={async () => {
            const ok = await onSave({ partyKey: key, percents })
            if (ok) onClose()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function MoveDialog({
  custody,
  kind,
  executed,
  busy,
  archived,
  onClose,
  onSave,
}: {
  custody: PmSubCustody
  kind: "iss" | "back" | "cnt"
  executed: number
  busy: string | null
  archived: boolean
  onClose: () => void
  onSave: SaveFn<{ q: number; day: string; note: string | null }>
}) {
  const t = useTranslations("Portal.PM")
  const [q, setQ] = useState("")
  const [day, setDay] = useState(todayDay())
  const [note, setNote] = useState("")
  const f = custodyFigures(custody, executed)
  const qn = num(q)
  const blocks = moveBlocks({ archived, kind, q: qn, issued: f.issued, day, today: todayDay() })
  const gap = kind === "cnt" && Number.isFinite(qn) ? Math.round((f.book - qn) * 100) / 100 : null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(`subs.recon.move_title_${kind}`)}</DialogTitle>
          <DialogDescription dir="auto">
            {custody.party.name} — {custody.material} · {t("subs.recon.custody_no", { no: custodyNo(custody.seq) })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {kind === "cnt" && (
            <>
              <Callout tone="info">{t("subs.recon.count_note")}</Callout>
              <div className="rounded-xl border px-3">
                <KeyValueRow label={t("subs.recon.col.issued")} value={`${qty(f.issued)} ${custody.unit}`} ltr />
                <KeyValueRow label={t("subs.recon.earned")} value={qty(f.theoretical + f.allowed)} ltr />
                <KeyValueRow label={t("subs.recon.should_hold")} value={qty(f.book)} ltr strong />
              </div>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mv-q">
                {t(`subs.recon.move_qty_${kind}`)} ({custody.unit}) *
              </Label>
              <Input id="mv-q" dir="ltr" type="number" min={0} step={0.01} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mv-day">{kind === "cnt" ? t("subs.recon.count_day") : t("subs.recon.day")}</Label>
              <Input id="mv-day" dir="ltr" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
          </div>
          {gap !== null &&
            (gap > 0.005 ? (
              <Callout tone="block" title={t("subs.recon.short", { qty: qty(gap), unit: custody.unit })}>
                {t("subs.recon.short_note")}
              </Callout>
            ) : gap < -0.005 ? (
              <Callout tone="info">{t("subs.recon.more", { qty: qty(-gap) })}</Callout>
            ) : (
              <Callout tone="info">{t("subs.recon.exact")}</Callout>
            ))}
          <div className="space-y-1.5">
            <Label htmlFor="mv-note">{t("subs.form.note")}</Label>
            <Input id="mv-note" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "cnt" ? t("subs.recon.count_note_ph") : ""} />
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.filter((b) => b !== "archived").map((b) => t(`subs.block.${b}`))} />
        </div>
        <Footer
          onClose={onClose}
          busy={busy !== null}
          disabled={blocks.length > 0}
          label={t(`subs.recon.move_save_${kind}`)}
          onSave={async () => {
            const ok = await onSave({ q: qn, day, note: note || null })
            if (ok) onClose()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function RecoverDialog({
  custody,
  executed,
  money,
  busy,
  archived,
  onClose,
  onSave,
}: {
  custody: PmSubCustody
  executed: number
  money: boolean
  busy: string | null
  archived: boolean
  onClose: () => void
  onSave: SaveFn<{ q: number; rate: number; double: boolean; note: string | null }>
}) {
  const t = useTranslations("Portal.PM")
  const f = custodyFigures(custody, executed)
  const [q, setQ] = useState(f.gap !== null && f.gap > 0 ? String(f.gap) : "")
  const [rate, setRate] = useState(custody.unitCost > 0 ? String(custody.unitCost) : "")
  const [double, setDouble] = useState(false)
  const [note, setNote] = useState("")
  const blocks = recoveryBlocks({ archived, q: num(q), rate: num(rate) })
  const amount = recoveryAmount(num(q) || 0, num(rate) || 0, double)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("subs.recon.recover_title")}</DialogTitle>
          <DialogDescription dir="auto">
            {custody.party.name} — {custody.material}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Callout tone="info">{t("subs.recon.recover_note")}</Callout>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rc-q">
                {t("subs.recon.recover_qty")} ({custody.unit}) *
              </Label>
              <Input id="rc-q" dir="ltr" type="number" min={0} step={0.01} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-rate">{t("subs.recon.recover_rate")} *</Label>
              <Input id="rc-rate" dir="ltr" type="number" min={0} step={0.01} value={rate} onChange={(e) => setRate(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("subs.recon.recover_rate_hint")}</p>
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border p-3">
            <Checkbox checked={double} onCheckedChange={(v) => setDouble(v === true)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-semibold">{t("subs.recon.double")}</span>
              <span className="block text-xs text-muted-foreground">{t("subs.recon.double_hint")}</span>
            </span>
          </label>
          {money && (
            <div className="rounded-xl border px-3">
              <KeyValueRow label={t("subs.recon.to_deduct")} value={pmMoney(amount)} ltr strong />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="rc-note">{t("subs.recon.basis")}</Label>
            <Input id="rc-note" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("subs.recon.basis_ph")} />
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.filter((b) => b !== "archived").map((b) => t(`subs.block.${b}`))} />
        </div>
        <Footer
          onClose={onClose}
          busy={busy !== null}
          disabled={blocks.length > 0}
          tone="destructive"
          label={t("subs.recon.recover_save")}
          onSave={async () => {
            const ok = await onSave({ q: num(q), rate: num(rate), double, note: note || null })
            if (ok) onClose()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
