"use client"

// «ما يعنيه هذا العقد نقداً» — the terms in force added up in riyals: what never
// reaches you before handover, what reaches you upfront, the worst-case delay
// damages, and the gap you fund yourself. Holders of money only.

import { useTranslations } from "next-intl"
import { Banknote } from "lucide-react"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { termsCash } from "@/lib/pm/contract-record"
import { pmMoney } from "@/lib/pm/format"
import type { ContractTerms } from "@/lib/pm/terms"

export function TermsCashPanel({ terms, contractValue }: { terms: ContractTerms; contractValue: number }) {
  const t = useTranslations("Portal.PM")
  const c = termsCash(terms, contractValue)
  const paid = terms.payer !== "none"
  return (
    <Panel title={t("terms.cash.title")} icon={Banknote}>
      <KeyValueRow label={t("terms.cash.value")} value={pmMoney(c.value)} ltr />
      {paid && <KeyValueRow label={t("terms.cash.never_before")} value={pmMoney(c.heldUntilHandover)} ltr />}
      {paid && <KeyValueRow label={t("terms.cash.upfront")} value={pmMoney(c.upfront)} ltr />}
      {terms.damages.on && <KeyValueRow label={<span className="text-destructive">{t("terms.cash.worst")}</span>} value={<span className="text-destructive">{pmMoney(c.worstDamages)}</span>} ltr />}
      <KeyValueRow label={t("terms.cash.gap")} value={pmMoney(c.gap)} ltr strong />
      <Callout tone="info" className="mt-3">
        {t("terms.cash.note")}
      </Callout>
    </Panel>
  )
}
