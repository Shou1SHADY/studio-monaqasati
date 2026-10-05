"use client"

// My day with punches (optional: punch; the prototype's x5Me «حضوري» and the
// meHome «يومي» rows): his shift «الدوام» and how his attendance comes in, and
// — where his workplace punches by the app — today's in / out and the punch
// button. His location is read at the moment he punches, never tracked; he is
// told so and agrees first. A punch outside the workplace's radius is recorded
// as outside and decided by a person; if he was on duty elsewhere he asks for a
// correction.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Fingerprint, Loader2, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { appPunchOn, fenceCheck, scheduleOf, sourceOf, type AppPunch, type PunchSite } from "@/lib/hr/punches"
import { appPunchBlocks, punchFromApp } from "@/lib/hr/punch-writes"
import { mh, shiftOf, type EmployeeShift } from "@/lib/hr/shifts"
import { HrWriteError } from "@/lib/hr/write-guard"
import type { MyFileCtx } from "./HrMyFile"

const CONSENT_KEY = "hr-punch-consent"

const consented = () => {
  try {
    return window.localStorage.getItem(CONSENT_KEY) === "1"
  } catch {
    return false
  }
}

/** «الدوام» — the shift (or the workplace's schedule), a night shift ending the next morning. */
export function useMyShiftText(ctx: Pick<MyFileCtx, "emp" | "site" | "today">) {
  const t = useTranslations("Portal.HR")
  const emp = ctx.emp as MyFileCtx["emp"] & { shift?: EmployeeShift | null }
  const site = ctx.site as PunchSite | null
  const sc = scheduleOf(site, emp, ctx.today)
  const sh = shiftOf(emp, site, ctx.today)
  const times = `${mh(sc.in)}–${mh(sc.out)}${sc.out >= 1440 ? " +1" : ""}`
  return { name: sh ? t(`punch.shift.${sh.id}`) : null, times }
}

export function HrMyPunch({ ctx }: { ctx: MyFileCtx }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<"in" | "out" | null>(null)
  const emp = ctx.emp as MyFileCtx["emp"] & { shift?: EmployeeShift | null; pn?: AppPunch | null; py?: AppPunch | null }
  const site = ctx.site as PunchSite | null
  const source = sourceOf(emp.siteId ? site : null, true)
  const shift = useMyShiftText(ctx)
  const mine = appPunchOn(emp, ctx.today)
  const kind: "in" | "out" = mine?.in ? "out" : "in"
  const done = Boolean(mine?.in && mine?.out)
  const active = emp.status === "active"
  const outside = emp.pn?.day === ctx.today && (emp.pn.inside === false || emp.pn.outInside === false)

  const punch = (k: "in" | "out") => {
    if (!firestore) return
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast({ title: t("punch.me.no_location"), variant: "destructive" })
      return
    }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const fence = fenceCheck(site, { lat: p.coords.latitude, lng: p.coords.longitude })
        try {
          await punchFromApp(firestore, emp, source, k, { inside: fence.inside, d: fence.d }, { today: ctx.today })
          toast({ title: t(fence.inside === false ? "punch.me.saved_outside" : k === "in" ? "punch.me.saved_in" : "punch.me.saved_out", { d: fence.d ?? 0, r: fence.r }) })
        } catch (err) {
          console.error(err)
          const key = err instanceof HrWriteError && err.blocks[0] ? `punch.block.${err.blocks[0]}` : "err.save"
          toast({ title: t.has(key) ? t(key) : t("err.save"), variant: "destructive" })
        } finally {
          setBusy(false)
        }
      },
      () => {
        setBusy(false)
        toast({ title: t("punch.me.no_location"), variant: "destructive" })
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }
  const start = (k: "in" | "out") => (consented() ? punch(k) : setAsking(k))

  return (
    <>
      <KeyValueRow
        label={t("punch.me.shift")}
        value={
          <span>
            {shift.name ? `${shift.name} · ` : ""}
            <bdi dir="ltr" className="tabular-nums">
              {shift.times}
            </bdi>
          </span>
        }
      />
      <KeyValueRow label={t("punch.me.source")} value={t(`punch.src.${source}`)} />
      {source === "app" && active && (
        <div className="space-y-2 pt-2">
          <KeyValueRow
            label={t("punch.me.today")}
            value={
              mine?.in ? (
                <bdi dir="ltr" className="tabular-nums">
                  {mine.in}
                  {mine.out ? ` – ${mine.out}` : ""}
                </bdi>
              ) : (
                t("punch.me.not_yet")
              )
            }
          />
          {outside && (
            <Callout tone="warn" title={t("punch.me.outside_title")}>
              {t("punch.me.outside")}
            </Callout>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {done ? (
              <StatusPill tone="ok">{t("punch.me.done")}</StatusPill>
            ) : (
              <Button size="sm" onClick={() => start(kind)} disabled={busy || appPunchBlocks(emp, source, kind, ctx.today).length > 0}>
                {busy ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <MapPin size={14} className="me-1.5" aria-hidden="true" />}
                {t(kind === "in" ? "punch.me.in" : "punch.me.out")}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => ctx.ask("attfix")}>
              {t("punch.me.correction")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("punch.me.location_note")}</p>
        </div>
      )}
      {source === "device" && <p className="pt-2 text-[11px] text-muted-foreground">{t("punch.me.device_note")}</p>}

      <Dialog open={asking !== null} onOpenChange={(o) => !o && setAsking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Fingerprint size={18} aria-hidden="true" />
              {t("punch.me.consent_title")}
            </DialogTitle>
            <DialogDescription>{t("punch.me.consent")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(null)}>
              {t("cancel")}
            </Button>
            <Button
              onClick={() => {
                try {
                  window.localStorage.setItem(CONSENT_KEY, "1")
                } catch {
                  // A private window keeps no consent — he is asked again next time.
                }
                const k = asking
                setAsking(null)
                if (k) punch(k)
              }}
            >
              {t("punch.me.consent_ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
