"use client"

// Settings → «الاشتراك» (Procurement 2.0, PKG-05 / B-11): what the company's subscription holds, read-only. The base
// (Procurement and Inventory, always) and the three connectors the admin opens — Projects, Finance, Manufacturing —
// each with what it adds, or what the company does without it. There is no switch here: the Mdmak team opens the
// subscription from the admin portal.

import { useTranslations } from "next-intl"
import { Check, Plus } from "lucide-react"
import { useModules } from "@/hooks/useCompanyModules"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { CONNECTORS, connectorTexts, packageLabel, packageOf, packageTitle, type Connector } from "@/lib/procurement/package"

export function SubscriptionPanel() {
  const t = useTranslations("Portal.ProcSubscription")
  const tp = useTranslations("Portal.ProcPackage")
  const { off } = useModules()
  const pkg = packageOf(Array.from(off))

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border bg-card" aria-label={t("title")}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-foreground">{t("title")}</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{t("sub", { title: packageTitle(pkg, tp) })}</p>
        </div>
        <StatusPill tone="module" className="shrink-0">
          {tp("chip", { label: packageLabel(pkg, tp) })}
        </StatusPill>
      </header>

      <ul className="divide-y">
        {(["core", "inv"] as const).map((id) => (
          <li key={id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground">{tp(`base.${id}.name`)}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{tp(`base.${id}.add1`)}</p>
            </div>
            <StatusPill tone="mute">{tp("sub.pill_base")}</StatusPill>
          </li>
        ))}
        {CONNECTORS.map((conn) => (
          <ConnectorRow key={conn} conn={conn} on={pkg[conn]} tp={tp} inLabel={tp("sub.pill_in")} addsLabel={tp("sub.pill_adds")} notSubscribed={tp("sub.not_subscribed")} />
        ))}
      </ul>

      <p className="border-t bg-muted/20 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground" dir="auto">
        {tp("sub.footer")}
      </p>
    </section>
  )
}

function ConnectorRow({
  conn,
  on,
  tp,
  inLabel,
  addsLabel,
  notSubscribed,
}: {
  conn: Connector
  on: boolean
  tp: (key: string, values?: Record<string, string | number>) => string
  inLabel: string
  addsLabel: string
  notSubscribed: string
}) {
  const texts = connectorTexts(conn, tp)
  return (
    <li className="px-4 py-3.5" data-connector={conn} data-subscribed={on}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">{texts.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{texts.question}</p>
        </div>
        <StatusPill tone={on ? "ok" : "warn"}>{on ? inLabel : addsLabel}</StatusPill>
      </div>
      <ul className="mt-2 space-y-1">
        {(on ? texts.adds : texts.without).map((line, i) => (
          <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-foreground">
            {on ? <Check size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" /> : <Plus size={13} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span>
              {!on && i === 0 && <span className="text-muted-foreground">{notSubscribed}</span>}
              {line}
            </span>
          </li>
        ))}
      </ul>
    </li>
  )
}
