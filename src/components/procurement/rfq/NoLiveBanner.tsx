"use client"

// «لا عرض حيّاً» (RFQ-15): the round closed with nothing, or every offer was excluded. Two exits, the same on the offers tab, the
// comparison tab and in Today: «أعد فتحه» with a new deadline (the link works again) or «ألغِ الطلب» (its lines go back to «الواردة»).

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { riyadhDay } from "@/lib/hr/format"
import { actsOnRfq, type RfqWriteActor } from "@/lib/procurement/rfq-access"
import type { NoLive } from "@/lib/procurement/rfq-no-live"
import { lifecycleState, RfqLifecycleDialogs, useRfqLifecycle, type LifecycleRfq } from "./RfqLifecycleBar"

export function NoLiveBanner({ rfq, actor, reason, onChanged }: { rfq: LifecycleRfq; actor: RfqWriteActor; reason: NoLive; onChanged?: () => void }) {
  const t = useTranslations("Portal.Procurement.rfqlife")
  const state = useRfqLifecycle(rfq, onChanged)
  const acts = Boolean(lifecycleState(rfq, riyadhDay())) && actsOnRfq(rfq, actor)
  return (
    <Callout tone="block" title={reason === "all_excluded" ? t("no_live_all_excluded") : t("no_live_closed_empty")}>
      <p>{t("no_live_hint")}</p>
      {acts && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => state.setDialog("extend")}>
            {t("no_live_reopen")}
          </Button>
          <Button type="button" size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => state.setDialog("cancel")}>
            {t("no_live_cancel")}
          </Button>
        </div>
      )}
      <RfqLifecycleDialogs rfq={rfq} state={state} />
    </Callout>
  )
}
