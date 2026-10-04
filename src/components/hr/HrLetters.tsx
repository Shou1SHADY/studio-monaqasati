"use client"

// Letters as a list (EM-08, WF-24): what was asked, for whom, where it stands —
// with whom while it waits, the serial once issued, the reason on the same line
// when declined — and the one action this viewer holds: sign (the signer),
// view and print (the issued letter). Three placements: the employee's own in
// My file, an employee's in his file (the HR manager may ask for him there),
// and the signer's queue — "letters waiting for your signature".

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { FileSignature, FileText, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useHrLetters } from "@/hooks/useHrLetters"
import { Link } from "@/i18n/routing"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate } from "@/lib/hr/format"
import { letterNoDisplay, maySignLetter, requestableKinds, type HrLetter, type LetterState } from "@/lib/hr/letters"
import { LetterDialog, letterLabel, NewLetterDialog } from "./HrLetterDialogs"
import type { HrPortal } from "./HrShell"

export const LETTER_TONE: Record<LetterState, PillTone> = { pending: "warn", issued: "ok", declined: "bad" }

export function HrLetterList({ access, actor, letters, portal, showEmployee = true, empty }: { access: HrAccess; actor: HrActor; letters: HrLetter[]; portal?: HrPortal; showEmployee?: boolean; empty: string }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const [open, setOpen] = useState<string | null>(null)
  const opened = letters.find((l) => l.id === open) ?? null

  if (letters.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>

  return (
    <>
      <ul className="divide-y rounded-xl border">
        {letters.map((l) => {
          const sign = l.state === "pending" && access.allowed("letter.sign") && maySignLetter(access.ctx, l) === null
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1 basis-60 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {l.serial && (
                    <span className="font-bold tabular-nums" dir="ltr">
                      {letterNoDisplay(l.serial, locale)}
                    </span>
                  )}
                  <span className="font-semibold" dir="auto">
                    {letterLabel(t, l)}
                  </span>
                  {showEmployee &&
                    (portal ? (
                      <Link href={`/${portal}/hr/people/${l.employeeId}`} className="rounded hover:text-module focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
                        {l.employeeName}
                      </Link>
                    ) : (
                      <span dir="auto">{l.employeeName}</span>
                    ))}
                  <StatusPill tone={LETTER_TONE[l.state]}>{t(`letter.state.${l.state}`)}</StatusPill>
                  {l.onBehalf && <StatusPill tone="mute">{t("letter.on_behalf")}</StatusPill>}
                </p>
                <p className="text-xs text-muted-foreground" dir="auto">
                  {t("letter.to_line", { to: l.addressee, lang: t(`letter.lang_name.${l.lang}`) })} · {hrDate(l.createdAt, locale)}
                </p>
                {l.state === "pending" && <p className="text-xs text-muted-foreground">{t("letter.with", { who: t(`letter.signer.${l.signerLevel}`) })}</p>}
                {l.state === "pending" && l.purpose && sign && (
                  <p className="line-clamp-2 text-xs text-muted-foreground" dir="auto">
                    “{l.purpose}”
                  </p>
                )}
                {l.state === "declined" && (
                  <p className="text-xs text-destructive" dir="auto">
                    {t("letter.declined_reason", { reason: l.decision?.note ?? "" })}
                  </p>
                )}
              </div>
              {(sign || l.state === "issued") && (
                <Button size="sm" variant={sign ? "default" : "outline"} onClick={() => setOpen(l.id)}>
                  {sign ? <FileSignature size={14} className="me-1.5" aria-hidden="true" /> : <FileText size={14} className="me-1.5" aria-hidden="true" />}
                  {t(sign ? "letter.sign" : "letter.view")}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {opened && <LetterDialog access={access} actor={actor} letter={opened} onClose={() => setOpen(null)} />}
    </>
  )
}

/** An employee's letters — in My file (his own) or in his file (HR asks for him there). */
export function HrLettersPanel({ access, actor, emp, pay, portal }: { access: HrAccess; actor: HrActor; emp: HrEmployee; pay: EmployeePay | null; portal?: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const { letters: all } = useHrLetters(access)
  const letters = useMemo(() => all.filter((l) => l.employeeId === emp.id), [all, emp.id])
  const [asking, setAsking] = useState(false)
  const own = Boolean(access.ctx.employeeId) && access.ctx.employeeId === emp.id
  const mayAsk = (own || access.allowed("letter.file")) && requestableKinds(emp.status).length > 0
  return (
    <Panel
      title={t("letter.title")}
      icon={FileText}
      count={letters.length}
      actions={
        mayAsk ? (
          <Button size="sm" variant="outline" onClick={() => setAsking(true)}>
            <Plus size={14} className="me-1.5" aria-hidden="true" />
            {t("letter.request")}
          </Button>
        ) : null
      }
    >
      <HrLetterList access={access} actor={actor} letters={letters} portal={portal} showEmployee={false} empty={t("letter.none")} />
      {asking && <NewLetterDialog access={access} actor={actor} emp={emp} pay={pay} onClose={() => setAsking(false)} />}
    </Panel>
  )
}

