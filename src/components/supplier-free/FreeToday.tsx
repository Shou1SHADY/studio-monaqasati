"use client"

// Today (PRD TDY-01…07, G-04, G-11, G-12): the banner with its three figures, "Need your reply" — commitments only, in the
// one working order, three cards then all — and the open requests (four compact cards). No "your space" cards, no win rate,
// no 30-day totals: that is what the subscription adds (B-05). A new account sees a welcome and "nothing yet", never zeros.

import { ArrowLeft, ArrowRight, Check, Store, X } from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "@/i18n/routing"
import { cn } from "@/lib/utils"
import { useFree } from "./useFree"
import { RequestCard } from "./RequestCard"
import { TaskCard } from "./TaskCard"
import { useQueryState } from "./ui"

const WELCOME_KEY = (uid: string) => `mdmak.supplierFree.welcomeClosed.${uid}`
/** Closed welcomes for this session, so closing it holds even when browser storage is blocked. */
const welcomeMemory = new Set<string>()

export function welcomeClosed(uid: string): boolean {
  if (welcomeMemory.has(uid)) return true
  try {
    return window.localStorage.getItem(WELCOME_KEY(uid)) === "1"
  } catch {
    return false
  }
}

export function closeWelcome(uid: string): void {
  welcomeMemory.add(uid)
  try {
    window.localStorage.setItem(WELCOME_KEY(uid), "1")
  } catch {
    /* closed for this session only */
  }
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-primary"

export function FreeToday() {
  const f = useFree()
  if (!f.ready) return <TodaySkeleton label={f.t("loadingWorld")} />
  return <TodayBody />
}

function TodaySkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-5" role="status" aria-busy="true" aria-label={label}>
      <div className="h-32 animate-pulse rounded-2xl bg-primary/80" />
      <div className="h-5 w-40 animate-pulse rounded bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
    </div>
  )
}

function TodayBody() {
  const f = useFree()
  const { t, L, fmt, profile, today, world } = f
  const q = useQueryState()
  const [showAll, setShowAll] = useState(false)
  const [closed, setClosed] = useState(true)
  const uid = profile?.uid || ""
  useEffect(() => setClosed(uid ? welcomeClosed(uid) : true), [uid])
  const all = L.allActs()
  const late = all.some((a) => a.due && L.daysTo(a.due) < 0)
  const shown = showAll ? all : all.slice(0, 3)
  const open = L.opps({})
  const k = L.dashK()
  const fresh = world.deals.length === 0 || (world.deals.length <= 3 && !all.length && !k.accUnsent && !k.owed)
  const welcome = fresh && !closed
  const first = ((profile?.name || "").trim().split(/\s+/)[0] || profile?.companyName || "").trim()
  const dayName = new Intl.DateTimeFormat(f.locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(`${today}T00:00:00Z`))
  const linked = world.deals.find((d) => d.offer) || world.deals[0]
  const linkedName = linked ? L.C(linked.c)?.name || "" : ""
  const Fwd = f.isAr ? ArrowLeft : ArrowRight
  const stat = "min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-start backdrop-blur-sm sm:px-4"
  const figure = "block whitespace-nowrap text-lg font-black tabular-nums sm:text-2xl"
  const openAll = () => {
    setShowAll(true)
    document.getElementById("today-acts")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  const dismiss = () => {
    if (uid) closeWelcome(uid)
    setClosed(true)
  }

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-cta/30 p-4 text-primary-foreground shadow-lg sm:p-6">
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-50" aria-hidden="true">
          <defs>
            <pattern id="free-brk" width="64" height="36" patternUnits="userSpaceOnUse">
              <path d="M6 2h52l-6 14H0z" fill="none" className="stroke-white/10" />
              <path d="M38 20h52l-6 14H32z" fill="none" className="stroke-white/10" />
              <path d="M-26 20h52l-6 14h-52z" fill="none" className="stroke-white/10" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#free-brk)" />
        </svg>
        <div className="pointer-events-none absolute -top-24 -start-28 h-96 w-96 rounded-full bg-accent/25 blur-3xl [mask-image:radial-gradient(circle,black,transparent_65%)]" aria-hidden="true" />
        <div className="relative flex flex-wrap items-start justify-between gap-4 sm:gap-5">
          <div className="min-w-0 flex-1 basis-72">
            <h1 className="flex flex-wrap items-center gap-3 text-xl font-black sm:text-2xl">
              <span>
                {welcome ? t("welHi") : t("hiGreet")}
                {t("listSep")}
                <em className="not-italic text-accent">{first}</em>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold">
                <Store size={13} aria-hidden="true" />
                {t("roleSupplier")} · {t("planFree")}
              </span>
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-sidebar-foreground/80">
              <span dir="auto">{profile?.companyName}</span>
              <span aria-hidden="true">·</span>
              <span>
                {dayName}
                {t("listSep")}
                {fmt.date(today, true)}
              </span>
            </p>
            {welcome && linkedName && <p className="mt-2 max-w-xl text-sm text-sidebar-foreground/80">{t("welX", { c: linkedName })}</p>}
            {welcome && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/supplier/profile" className={cn("inline-flex h-8 items-center rounded-lg bg-accent px-3 text-xs font-bold text-accent-foreground hover:bg-accent/90", focusRing)}>
                  {t("profComplete")}
                </Link>
                <button type="button" onClick={dismiss} className={cn("inline-flex h-8 items-center gap-1 rounded-lg border border-white/20 px-3 text-xs font-bold text-white hover:bg-white/10", focusRing)}>
                  <X size={13} aria-hidden="true" />
                  {t("close")}
                </button>
              </div>
            )}
          </div>
          {fresh ? (
            <div className={cn(stat, "self-center")}>
              <b className="block text-base font-black">{t("nothingYet")}</b>
            </div>
          ) : (
            <div className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:gap-3">
              <button type="button" onClick={openAll} className={cn(stat, "block hover:bg-white/10", focusRing)}>
                <b className={figure} dir="ltr">
                  {all.length}
                </b>
                <span className="flex items-center gap-1 text-[11px] text-sidebar-foreground/80">
                  {late && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />}
                  {t("hsActs")}
                </span>
              </button>
              <Link href="/supplier/orders?seg=you" className={cn(stat, "block hover:bg-white/10", focusRing)}>
                <b className={figure} dir="ltr">
                  {fmt.kM(k.accUnsent)} <small className="text-[11px] font-bold text-sidebar-foreground/80 sm:text-xs">{fmt.cur}</small>
                </b>
                <span className="text-[11px] text-sidebar-foreground/80">{t("hsUnsent")}</span>
              </Link>
              <Link href="/supplier/invoices" className={cn(stat, "block hover:bg-white/10", focusRing)}>
                <b className={figure} dir="ltr">
                  {fmt.kM(k.owed)} <small className="text-[11px] font-bold text-sidebar-foreground/80 sm:text-xs">{fmt.cur}</small>
                </b>
                <span className="text-[11px] text-sidebar-foreground/80">{t("dkOwed")}</span>
              </Link>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="today-acts-h" id="today-acts" className="scroll-mt-20">
        <div className="mb-3 flex items-center gap-2">
          <h2 id="today-acts-h" className="text-base font-black">
            {t("secActs")}
          </h2>
          {all.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">{all.length}</span>}
          {all.length > 3 && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="ms-auto inline-flex items-center gap-1 rounded text-xs font-bold text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
          <Link href="/supplier/rfqs" className="ms-auto inline-flex items-center gap-1 rounded text-xs font-bold text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("seeAllOpps")}
            <Fwd size={13} aria-hidden="true" />
          </Link>
        </div>
        {open.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {open.slice(0, 4).map((d) => (
              <RequestCard key={d.id} f={f} d={d} href={q.href} onArchive={(id, on) => void f.archive([id], on)} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-card px-4 py-5 text-sm text-muted-foreground">{fresh ? t("nothingYet") : t("oppEmpty")}</div>
        )}
      </section>
    </div>
  )
}
