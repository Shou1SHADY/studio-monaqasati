"use client"

// Money › Certificates & collection on a PM 1.0 project (WF-05, IPC-01…05).
// The list reads as the consultant would: each certificate with its period,
// the work value as certified (and what the consultant cut), the net claim,
// what Finance collected and how late the rest is, with the totals. Unbilled
// executed work is the loudest note on the page. A row opens the certificate's
// drawer, where it is approved, certified or withdrawn; the collection side
// panel reads Finance. Holders of money with the client side (client + ipc);
// a project nobody pays has no certificates.

import { useMemo, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Banknote, FileCheck2, Plus, Receipt, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { inForce, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import {
  certificateNo,
  certificatePeriods,
  CERTIFICATE_STATUSES,
  certificateTotals,
  collectedAmount,
  collectionFigures,
  lateDays,
  PM_CERTIFICATES,
  unbilledValue,
  voClaimAmount,
  voClaimable,
  type ClaimableVariation,
} from "@/lib/pm/certificate"
import type { CertificateActor, PmCertificate } from "@/lib/pm/certificate-writes"
import { pmDate, pmMoney, pmPct, todayDay } from "@/lib/pm/format"
import { subSummaries, subTotals, PM_SUBCONTRACTS, type PmSubcontract } from "@/lib/pm/subcontract"
import type { ContractTerms } from "@/lib/pm/terms"
import { PM_VARIATIONS } from "@/lib/pm/variation"
import { cn } from "@/lib/utils"
import { CERT_TONE, CertificateDrawer } from "./CertificateDrawer"
import { CertifyDialog } from "./CertifyDialog"
import { PrepareCertificateDialog, type CertItem } from "./PrepareCertificateDialog"


const Row = ({ label, value, tone }: { label: ReactNode; value: string; tone?: "bad" | "total" }) => (
  <div className={cn("flex items-baseline justify-between gap-3 px-4 py-2 text-sm", tone === "total" && "border-t bg-muted/40 font-bold")}>
    <span className={cn(tone === "bad" && "font-semibold text-destructive")}>{label}</span>
    <span className={cn("shrink-0 tabular-nums", tone === "bad" && "text-destructive")} dir="ltr">
      {value}
    </span>
  </div>
)

export function CertificatesPanel({
  projectId,
  projectName,
  original,
  lifecycle,
  startOn,
  contractValue,
  totals,
  retentionReleased,
  items,
  showCollection = true,
  onOpenHandover,
  access,
  actor,
  onItemsChanged,
}: {
  projectId: string
  projectName?: string
  original: ContractTerms
  lifecycle: string
  startOn?: string | null
  contractValue: number
  totals: { retentionHeld?: number; advanceRecovered?: number; cutPool?: number }
  retentionReleased?: boolean
  items: CertItem[]
  /** The `collect` section is on: the collection side panel shows beside the list. */
  showCollection?: boolean
  onOpenHandover?: () => void
  access: PmAccess
  actor: CertificateActor
  onItemsChanged?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const [preparing, setPreparing] = useState(false)
  const [openSeq, setOpenSeq] = useState<number | null>(null)
  const [certifying, setCertifying] = useState<PmCertificate | null>(null)
  const money = access.has("money")
  const today = todayDay()

  const certQuery = useMemoFirebase(() => (firestore && money ? collection(firestore, "projects", projectId, PM_CERTIFICATES) : null), [firestore, projectId, money])
  const { data } = useCollection(certQuery)
  const certs = useMemo(() => ((data ?? []) as unknown as PmCertificate[]).slice().sort((a, b) => b.seq - a.seq), [data])
  const addQuery = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_ADDENDA) : null), [firestore, projectId])
  const { data: addData } = useCollection(addQuery)
  const terms = useMemo(() => inForce(original, (addData ?? []) as unknown as PmAddendum[]), [original, addData])
  const voQuery = useMemoFirebase(() => (firestore && money ? collection(firestore, "projects", projectId, PM_VARIATIONS) : null), [firestore, projectId, money])
  const { data: voData } = useCollection(voQuery)
  const vos = useMemo(() => (voData ?? []) as unknown as ClaimableVariation[], [voData])
  const subQuery = useMemoFirebase(() => (firestore && money && showCollection ? collection(firestore, "projects", projectId, PM_SUBCONTRACTS) : null), [firestore, projectId, money, showCollection])
  const { data: subData } = useCollection(subQuery)

  const periods = useMemo(() => certificatePeriods(certs, startOn ?? null), [certs, startOn])
  const sum = useMemo(() => certificateTotals(certs), [certs])
  const coll = useMemo(
    () => collectionFigures({ certs, today, contractValue, advance: terms.advance, started: lifecycle !== "plan", retentionReleased: Boolean(retentionReleased) }),
    [certs, today, contractValue, terms.advance, lifecycle, retentionReleased]
  )
  const subRetention = useMemo(() => subTotals(subSummaries((subData ?? []) as unknown as PmSubcontract[])).retention, [subData])

  const held = totals.retentionHeld ?? 0
  const recovered = totals.advanceRecovered ?? 0
  const cutPool = totals.cutPool ?? 0
  const unbilled = items.reduce((a, i) => a + unbilledValue(i), 0) + voClaimable(vos).reduce((a, v) => a + voClaimAmount(v), 0) + cutPool
  const canPrepare = !access.ctx.archived && access.allowed("certificate.prepare") && terms.payer !== "none"
  const payer = t(`money.payer.${terms.payer === "main" ? "main" : "owner"}`)
  const opened = openSeq === null ? null : certs.find((c) => c.seq === openSeq) ?? null

  if (!money) return <Callout tone="info">{t("ipc.money_only")}</Callout>
  if (!(access.has("client") && access.has("ipc"))) return <Callout tone="info">{t("money.ipc_client_only")}</Callout>

  const list = (
    <div className="space-y-3">
      {terms.payer === "none" && <Callout tone="info">{t("ipc.no_client")}</Callout>}
      {terms.payer !== "none" && unbilled > 1000 && (
        <Callout tone={unbilled > 50_000 ? "block" : "warn"} title={t("money.unbilled_title", { amount: pmMoney(unbilled) })}>
          <span className="block">{t("money.unbilled_body")}</span>
          {canPrepare && (
            <Button size="sm" className="mt-2" onClick={() => setPreparing(true)}>
              <Plus size={14} className="me-1.5" aria-hidden="true" />
              {t("money.prepare_now")}
            </Button>
          )}
        </Callout>
      )}
      <Panel
        title={t("money.certs_title")}
        icon={Receipt}
        count={certs.filter((c) => c.status === "int" || c.status === "sub").length || undefined}
        actions={
          canPrepare ? (
            <Button size="sm" onClick={() => setPreparing(true)}>
              <FileCheck2 size={15} className="me-1.5" aria-hidden="true" />
              {t("ipc.prepare")}
            </Button>
          ) : null
        }
        bodyClassName="p-0"
      >
        <p className="px-4 pt-3 text-xs text-muted-foreground">{t("money.certs_sub")}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-4 py-2 text-start font-semibold">{t("money.col.cert")}</th>
                <th className="px-3 py-2 text-end font-semibold">{t("money.col.work")}</th>
                <th className="px-3 py-2 text-end font-semibold">{t("money.col.net")}</th>
                <th className="px-3 py-2 text-end font-semibold">{t("money.col.collected")}</th>
                <th className="px-4 py-2 text-start font-semibold">{t("money.col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {certs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {t("money.no_certs")}
                  </td>
                </tr>
              )}
              {certs.map((c) => {
                const known = (CERTIFICATE_STATUSES as readonly string[]).includes(c.status)
                const p = periods.get(c.seq)
                const late = lateDays(c, today)
                const got = collectedAmount(c)
                return (
                  <tr
                    key={c.seq}
                    tabIndex={0}
                    onClick={() => setOpenSeq(c.seq)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        setOpenSeq(c.seq)
                      }
                    }}
                    className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", c.status === "void" && "opacity-60")}
                  >
                    <td className="px-4 py-2.5">
                      <p className="font-bold">{t("ipc.no", { no: certificateNo(c.seq) })}</p>
                      <p className="text-xs text-muted-foreground">{t("money.period", { from: pmDate(p?.from, locale), to: pmDate(p?.to, locale) })}</p>
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">
                      {pmMoney(c.gross)}
                      {(c.cut ?? 0) > 0 && <p className="text-xs text-destructive">{t("money.cut_short", { amount: pmMoney(c.cut ?? 0) })}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-end font-bold tabular-nums" dir="ltr">
                      {pmMoney(c.net)}
                    </td>
                    <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">
                      {got > 0 ? pmMoney(got) : "—"}
                      {late > 0 && <p className="text-xs text-destructive">{t("money.late", { days: late })}</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill tone={known ? CERT_TONE[c.status] : "bad"}>{known ? t(`ipc.status.${c.status}`) : t("unknown_state")}</StatusPill>
                    </td>
                  </tr>
                )
              })}
              {certs.length > 0 && (
                <tr className="bg-muted/40 font-bold">
                  <td className="px-4 py-2.5">{t("money.total")}</td>
                  <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">
                    {pmMoney(sum.gross)}
                  </td>
                  <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">
                    {pmMoney(sum.net)}
                  </td>
                  <td className="px-3 py-2.5 text-end tabular-nums" dir="ltr">
                    {pmMoney(sum.collected)}
                  </td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )

  const side = (
    <div className="space-y-3">
      <Panel title={t("money.coll.title")} icon={Banknote} actions={<SourceBadge module="payments" label={t("money.from_finance")} />} bodyClassName="p-0">
        <Row label={t("money.coll.outstanding", { payer })} value={pmMoney(coll.outstanding)} />
        <Row label={t("money.coll.overdue")} value={pmMoney(coll.overdue)} tone={coll.overdue > 0 ? "bad" : undefined} />
        {coll.late.map((l) => (
          <Row key={l.seq} label={t("money.coll.late_row", { no: certificateNo(l.seq), days: l.days })} value={pmMoney(l.amount)} tone="bad" />
        ))}
        <Row label={t("money.coll.cash_in")} value={pmMoney(coll.cashIn)} tone="total" />
      </Panel>
      <Panel title={t("money.coll.adv_ret")} icon={ShieldCheck} bodyClassName="p-0">
        <Row label={t("money.coll.adv_left", { rate: pmPct(terms.advance) })} value={pmMoney(coll.advanceLeft)} />
        <Row label={t("money.coll.ret_on_you", { payer, rate: pmPct(terms.retention) })} value={pmMoney(coll.retentionHeld)} />
        <Row label={t("money.coll.ret_on_subs")} value={pmMoney(subRetention)} />
        <Row label={t("money.coll.ret_net")} value={pmMoney(coll.retentionHeld - subRetention)} tone="total" />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
          <span className="text-xs text-muted-foreground">{t("money.coll.release_note")}</span>
          {onOpenHandover && (
            <Button size="sm" variant="outline" onClick={onOpenHandover}>
              {t("money.coll.handover")}
            </Button>
          )}
        </div>
      </Panel>
    </div>
  )

  return (
    <>
      {showCollection ? <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">{list}{side}</div> : list}

      {canPrepare && (
        <PrepareCertificateDialog
          open={preparing}
          onOpenChange={setPreparing}
          projectId={projectId}
          projectName={projectName}
          access={access}
          actor={actor}
          items={items}
          variations={vos}
          terms={terms}
          lifecycle={lifecycle}
          contractValue={contractValue}
          held={held}
          recovered={recovered}
          cutPool={cutPool}
          cutFrom={certs.filter((c) => (c.cut ?? 0) > 0).map((c) => ({ no: certificateNo(c.seq), reason: c.cutReason ?? "" }))}
          periodFrom={certs.find((c) => c.status !== "void")?.prepOn ?? startOn ?? null}
          onSaved={onItemsChanged}
        />
      )}
      <CertificateDrawer
        cert={opened}
        certs={certs}
        period={opened ? periods.get(opened.seq) ?? null : null}
        projectName={projectName}
        access={access}
        projectId={projectId}
        actor={actor}
        onClose={() => setOpenSeq(null)}
        onCertify={(c) => {
          setOpenSeq(null)
          setCertifying(c)
        }}
        onChanged={onItemsChanged}
      />
      {certifying && <CertifyDialog open onOpenChange={(o) => !o && setCertifying(null)} projectId={projectId} access={access} actor={actor} cert={certifying} held={held} recovered={recovered} />}
    </>
  )
}
