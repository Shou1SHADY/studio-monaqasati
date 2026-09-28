"use client"

// The employee file's actions (PRD §5 forms 4, 13, 14, 15; WF-10, WF-11,
// WF-13, WF-14): move · pay change · probation · record a renewal · link the
// platform user. Each says its blocking facts before saving; each write runs
// the guard and the blocks again and lands in the employee's log.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { useFirestore } from "@/firebase"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { DOC_TYPES, type DocType } from "@/lib/hr/documents"
import { assignBlocks, payChangeBlocks, probationBlocks, probationMaxEnd, renewalBlocks, type EmployeePay, type HrEmployee } from "@/lib/hr/employee"
import { assignEmployee, changePay, decideProbation, linkUser, recordRenewal, type HrActor } from "@/lib/hr/employee-writes"
import { hrMoney, todayDay } from "@/lib/hr/format"
import { payFromBasic, wageOf } from "@/lib/hr/pay"
import { UNASSIGNED_SITE, type HrSite } from "@/lib/hr/sites"
import { TRADES } from "@/lib/hr/trades"
import { HrWriteError } from "@/lib/hr/write-guard"

export type EmployeeAction = "move" | "pay" | "probation" | "renew" | "link"

function useRun(onDone: () => void) {
  const t = useTranslations("Portal.HR")
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, okKey: string, blockPrefix: string) => {
    setBusy(true)
    try {
      await fn()
      toast({ title: t(okKey) })
      onDone()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `${blockPrefix}.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

export function EmployeeActionDialog({
  action,
  onClose,
  access,
  actor,
  emp,
  pay,
  sites,
}: {
  action: EmployeeAction
  onClose: () => void
  access: HrAccess
  actor: HrActor
  emp: HrEmployee
  pay: EmployeePay | null
  sites: HrSite[]
}) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const today = todayDay()
  const { busy, run } = useRun(onClose)
  const { orgMembers } = useOrgMembers(access.orgId)
  const [siteId, setSiteId] = useState(emp.siteId ?? UNASSIGNED_SITE)
  const [effectiveOn, setEffectiveOn] = useState(today)
  const [basic, setBasic] = useState(String(pay?.basic ?? ""))
  const [reason, setReason] = useState("")
  const [kind, setKind] = useState<"raise" | "promotion" | "correction">("raise")
  const [trade, setTrade] = useState(emp.trade)
  const [decision, setDecision] = useState<"confirm" | "extend" | "end">("confirm")
  const [extTo, setExtTo] = useState(probationMaxEnd(emp.join))
  const [consentOn, setConsentOn] = useState("")
  const [docType, setDocType] = useState<DocType>("iqama")
  const [expiry, setExpiry] = useState("")
  const [fee, setFee] = useState("")
  const [userId, setUserId] = useState(emp.userId ?? "")

  let title = ""
  let body: React.ReactNode = null
  let blocks: string[] = []
  let blockPrefix = "err"
  let submit: () => void = () => {}

  if (action === "move") {
    title = t("file.act.move")
    const to = siteId === UNASSIGNED_SITE ? null : siteId
    blocks = assignBlocks(emp, to, effectiveOn || null, today)
    blockPrefix = "move.block"
    submit = () => void run(() => assignEmployee(firestore!, access.ctx, emp.id, actor, { siteId: to, effectiveOn }), "file.moved", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="mv-site">{t("move.to")}</Label>
          <SearchableSelect
            id="mv-site"
            value={siteId}
            onChange={setSiteId}
            options={[{ value: UNASSIGNED_SITE, label: t("sites.unassigned") }, ...sites.filter((s) => s.active !== false).map((s) => ({ value: s.id, label: s.name }))]}
            placeholder={t("move.to")}
            searchPlaceholder={t("search")}
            noResultsText={t("no_results")}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mv-on">{t("move.effective")}</Label>
          <Input id="mv-on" type="date" dir="ltr" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} disabled={busy} />
        </div>
        <p className="text-xs text-muted-foreground">{t("move.cost_note")}</p>
      </div>
    )
  } else if (action === "pay") {
    title = t("file.act.pay")
    const n = Number(basic)
    const current = pay?.basic ?? 0
    const res = payChangeBlocks({ basic: n, currentBasic: current, effectiveOn: effectiveOn || null, reason, nationality: emp.nationality, lastClosedMonthStart: null })
    blocks = res.blocks
    blockPrefix = "paychange.block"
    const next = n > 0 ? payFromBasic(n, access.settings.policies) : null
    submit = () => void run(() => changePay(firestore!, access.ctx, emp.id, actor, { basic: n, effectiveOn, reason, kind, trade: kind === "promotion" ? trade : null }, { policies: access.settings.policies }), "file.pay_changed", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pc-kind">{t("paychange.kind")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)} disabled={busy}>
              <SelectTrigger id="pc-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["raise", "promotion", "correction"] as const).map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`paychange.kinds.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-basic">{t("paychange.new_basic")}</Label>
            <Input id="pc-basic" type="number" min="0" step="any" dir="ltr" value={basic} onChange={(e) => setBasic(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pc-on">{t("paychange.effective")}</Label>
            <Input id="pc-on" type="date" dir="ltr" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} disabled={busy} />
          </div>
          {kind === "promotion" && (
            <div className="space-y-1.5">
              <Label htmlFor="pc-trade">{t("new.trade")}</Label>
              <SearchableSelect
                id="pc-trade"
                value={trade}
                onChange={setTrade}
                options={TRADES.map((x) => ({ value: x.key, label: t(`trade.${x.key}` as "trade.mason") }))}
                placeholder={t("new.pick_trade")}
                searchPlaceholder={t("search")}
                noResultsText={t("no_results")}
                disabled={busy}
              />
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-why">{t("paychange.reason")}</Label>
          <Input id="pc-why" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
        </div>
        {pay && next && (
          <div className="rounded-xl border p-3">
            <KeyValueRow label={t("paychange.from")} value={hrMoney(wageOf(pay))} ltr />
            <KeyValueRow label={t("paychange.to")} value={hrMoney(wageOf(next))} ltr strong />
          </div>
        )}
        {res.warnings.map((w) => (
          <Callout key={w} tone="warn">
            {t(`paychange.warn.${w}`)}
          </Callout>
        ))}
        <p className="text-xs text-muted-foreground">{t("paychange.retro_note")}</p>
      </div>
    )
  } else if (action === "probation") {
    title = t("file.act.probation")
    blocks = probationBlocks(emp, decision, { to: extTo, consentOn: consentOn || null })
    blockPrefix = "probation.block"
    submit = () => void run(() => decideProbation(firestore!, access.ctx, emp.id, actor, decision, { to: extTo, consentOn: consentOn || null }), "file.probation_done", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pb-d">{t("probation.decision")}</Label>
          <Select value={decision} onValueChange={(v) => setDecision(v as typeof decision)} disabled={busy}>
            <SelectTrigger id="pb-d">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["confirm", "extend", "end"] as const).map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`probation.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {decision === "extend" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pb-to">{t("probation.to")}</Label>
              <Input id="pb-to" type="date" dir="ltr" max={probationMaxEnd(emp.join)} value={extTo} onChange={(e) => setExtTo(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pb-c">{t("probation.consent")}</Label>
              <Input id="pb-c" type="date" dir="ltr" value={consentOn} onChange={(e) => setConsentOn(e.target.value)} disabled={busy} />
            </div>
          </div>
        )}
        {decision === "end" && <Callout tone="warn">{t("probation.end_note")}</Callout>}
      </div>
    )
  } else if (action === "renew") {
    title = t("file.act.renew")
    blocks = renewalBlocks(emp.docs ?? {}, docType, expiry || null, today)
    blockPrefix = "renew.block"
    submit = () => void run(() => recordRenewal(firestore!, access.ctx, emp.id, actor, { type: docType, expiry, fee: fee ? Number(fee) : null }), "file.renewed", blockPrefix)
    body = (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="rn-t">{t("renew.document")}</Label>
            <Select value={docType} onValueChange={(v) => setDocType(v as DocType)} disabled={busy}>
              <SelectTrigger id="rn-t">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`doc.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rn-e">{t("renew.expiry")}</Label>
            <Input id="rn-e" type="date" dir="ltr" value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rn-f">{t("renew.fee")}</Label>
            <Input id="rn-f" type="number" min="0" step="any" dir="ltr" value={fee} onChange={(e) => setFee(e.target.value)} disabled={busy} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("renew.note")}</p>
      </div>
    )
  } else {
    title = t("file.act.link")
    submit = () => void run(() => linkUser(firestore!, access.ctx, emp.id, actor, userId || null), "file.linked", "err")
    body = (
      <div className="space-y-2">
        <Label htmlFor="lk-u">{t("link.user")}</Label>
        <SearchableSelect
          id="lk-u"
          value={userId}
          onChange={setUserId}
          options={orgMembers.map((m) => ({ value: m.id, label: (m.name as string) || (m.email as string) || m.id }))}
          placeholder={t("link.pick")}
          searchPlaceholder={t("search")}
          noResultsText={t("no_results")}
          disabled={busy}
        />
        <p className="text-xs text-muted-foreground">{t("link.note")}</p>
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription dir="auto">{emp.names?.ar}</DialogDescription>
        </DialogHeader>
        {body}
        <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`${blockPrefix}.${b}`))} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || blocks.length > 0 || !firestore}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
