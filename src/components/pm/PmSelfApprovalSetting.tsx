"use client"

// AMD-10 — the organisation's recorded self-approval, in Settings › Team &
// permissions (never on a project page). The owner switches it; everyone else
// reads it. The certificate, measurement and subcontract writes read the same
// `pmSettings/{orgId}` document inside their own transactions.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { ShieldCheck } from "lucide-react"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate } from "@/lib/pm/format"
import { PM_SETTINGS, setOrgSelfApproval, type InfoActor, type PmOrgSettings } from "@/lib/pm/info-writes"
import { ChoiceChips, FormHint } from "./ContractBits"

export function PmSelfApprovalSetting({ orgId, isOwner, actor }: { orgId: string; isOwner: boolean; actor: InfoActor }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const ref = useMemoFirebase(() => (firestore && orgId ? doc(firestore, PM_SETTINGS, orgId) : null), [firestore, orgId])
  const { data } = useDoc(ref)
  const s = data as PmOrgSettings | null
  const self = s?.selfApproval === true

  const toggle = async (allowed: boolean) => {
    if (!firestore || !orgId || allowed === self) return
    setBusy(true)
    try {
      await setOrgSelfApproval(firestore, { owner: isOwner }, orgId, actor, allowed)
      toast({ title: t("glance.self_saved") })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : "error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t("glance.self_label")} icon={ShieldCheck}>
      {isOwner ? (
        <ChoiceChips
          label={t("glance.self_label")}
          options={[
            { id: "on", label: t("glance.self_on") },
            { id: "off", label: t("glance.self_off") },
          ]}
          value={self ? "on" : "off"}
          onChange={(v) => void toggle(v === "on")}
          disabled={busy}
        />
      ) : (
        <KeyValueRow label={t("glance.self_label")} value={self ? t("glance.self_on") : t("glance.self_off")} />
      )}
      <FormHint>{self ? t("glance.self_on_hint") : t("glance.self_off_hint")}</FormHint>
      {s?.selfApprovalByName && s.selfApprovalOn && <FormHint>{t("glance.self_by", { who: s.selfApprovalByName, date: pmDate(s.selfApprovalOn, locale) })}</FormHint>}
      {!isOwner && <FormHint>{t("glance.self_owner_only")}</FormHint>}
    </Panel>
  )
}
