"use client"

// Today (PRD TDY-01…07, G-04, G-11, G-12): the banner with its three figures, "Need your reply" — commitments only, in the
// one working order, three cards then all — and the open requests (four compact cards). No "your space" cards, no win rate,
// no 30-day totals: that is what the subscription adds (B-05). A new account sees a welcome and "nothing yet", never zeros.

import { ArrowLeft, ArrowRight, Check, Store } from "lucide-react"
import { useState } from "react"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { useFree } from "./useFree"
import { RequestCard } from "./RequestCard"
import { TaskCard } from "./TaskCard"
import { useQueryState } from "./ui"

export function FreeToday() {
  const f = useFree()
  const { t, L, fmt, profile, today, world } = f
  const q = useQueryState()
  const [showAll, setShowAll] = useState(false)
  const all = L.allActs()
  const late = all.some((a) => a.due && L.daysTo(a.due) < 0)
  const shown = showAll ? all : all.slice(0, 3)
  const open = L.opps({})
  const k = L.dashK()
  const fresh = world.deals.length === 0 || (world.deals.length <= 3 && !all.length && !k.accUnsent && !k.owed)
  const first = ((profile?.name || "").trim().split(/\s+/)[0] || profile?.companyName || "").trim()
  const dayName = new Intl.DateTimeFormat(f.locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${today}T00:00:00Z`))
  const Fwd = f.isAr ? ArrowLeft : ArrowRight
  const stat = "rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-start backdrop-blur-sm"

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-primary p-5 text-primary-foreground sm:p-6">
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-3 text-2xl font-black">
              <span>
                {fresh ? t("welHi") : t("hiGreet")}، <em className="not-italic text-accent">{first}</em>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold">
                <Store size={13} aria-hidden="true" />
                {t("roleSupplier")} · {t("planFree")}
              </span>
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-slate-300">
              <span dir="auto">{profile?.companyName}</span>
              <span aria-hidden="true">·</span>
              <span>
                {dayName}، {fmt.date(today, true)}
              </span>
            </p>
            {fresh && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/supplier/profile" className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-bold text-accent-foreground hover:bg-accent/90">
                  {t("profComplete")}
                </Link>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            <div className={stat}>
              <b className="block text-2xl font-black tabular-nums" dir="ltr">
                {all.length}
              </b>
              <span className="flex items-center gap-1 text-[11px] text-slate-300">
                {late && <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />}
                {t("hsActs")}
              </span>
            </div>
            <Link href="/supplier/orders?seg=you" className={cn(stat, "block hover:bg-white/10")}>
              <b className="block text-2xl font-black tabular-nums" dir="ltr">
                {fmt.kM(k.accUnsent)} <small className="text-xs font-bold text-slate-300">{fmt.cur}</small>
              </b>
              <span className="text-[11px] text-slate-300">{t("hsUnsent")}</span>
            </Link>
            <Link href="/supplier/invoices" className={cn(stat, "block hover:bg-white/10")}>
              <b className="block text-2xl font-black tabular-nums" dir="ltr">
                {fmt.kM(k.owed)} <small className="text-xs font-bold text-slate-300">{fmt.cur}</small>
              </b>
              <span className="text-[11px] text-slate-300">{t("dkOwed")}</span>
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="today-acts">
        <div className="mb-3 flex items-center gap-2">
          <h2 id="today-acts" className="text-base font-black">
            {t("secActs")}
          </h2>
          {all.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">{all.length}</span>}
          {all.length > 3 && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="ms-auto inline-flex items-center gap-1 text-xs font-bold text-module">
              {showAll ? t("showLess") : t("secAll", { n: all.length })}
              <Fwd size={13} aria-hidden="true" />
            </button>
          )}
        </div>
        {all.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((a, i) => (
              <TaskCard key={`${a.kind}:${a.deal || a.c}:${i}`} f={f} a={a} href={q.href} />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-dashed bg-card px-4 py-5 text-sm text-muted-foreground">
            <Check size={16} className="text-success" aria-hidden="true" />
            {fresh ? t("nothingYet") : t("actsEmpty")}
          </div>
        )}
      </section>

      <section aria-labelledby="today-open">
        <div className="mb-3 flex items-center gap-2">
          <h2 id="today-open" className="text-base font-black">
            {t("okOpen")}
          </h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">{open.length}</span>
          <Link href="/supplier/rfqs" className="ms-auto inline-flex items-center gap-1 text-xs font-bold text-module">
            {t("seeAllOpps")}
            <Fwd size={13} aria-hidden="true" />
          </Link>
        </div>
        {open.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {open.slice(0, 4).map((d) => (
              <RequestCard key={d.id} f={f} d={d} href={q.href} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm text-muted-foreground">{fresh ? t("nothingYet") : t("oppEmpty")}</div>
        )}
      </section>
    </div>
  )
}
