"use client"

// Letters (EM-08, WF-24): the request — the type (each with what it is for and
// who signs it), the letter he needs and its purpose where the type asks for
// them, the addressee and the letter's language — and the signer's sheet: the
// employee's words, the free text that starts from them, a live preview in the
// letter's language, then "issue & sign" or "decline" with a reason. An issued
// letter opens the same sheet with Print.

import { useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { Loader2, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useLetterPay } from "@/hooks/useHrLetters"
import { useHrRequests } from "@/hooks/useHrRequests"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { HR_EMPLOYEES } from "@/lib/hr/collections"
import type { EmployeePay, HrEmployee } from "@/lib/hr/employee"
import type { HrActor } from "@/lib/hr/employee-writes"
import { hrDate, todayDay } from "@/lib/hr/format"
import { declineLetter, fileLetter, issueLetter } from "@/lib/hr/letter-writes"
import {
  declineBlocks,
  initialLetterText,
  isFreeLetter,
  issueBlocks,
  letterBlocks,
  letterCardOf,
  letterNoDisplay,
  letterSignerLevel,
  maySignLetter,
  requestableKinds,
  signingRole,
  LETTER_LANGS,
  type HrLetter,
  type LetterHead,
  type LetterKind,
  type LetterLang,
} from "@/lib/hr/letters"
import { wageOf } from "@/lib/hr/pay"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"
import { LetterDocument, LetterInLanguage, printLetter } from "./LetterDocument"

type T = ReturnType<typeof useTranslations<"Portal.HR">>

/** "Other" reads as the letter he named; the rest by their type. */
export const letterLabel = (t: T, l: Pick<HrLetter, "kind" | "title">) => (l.kind === "oth" && l.title ? l.title : t(`letter.kind.${l.kind}`))

/** A write's refusal in words. */
export function letterError(t: T, err: unknown): string {
  if (err instanceof HrWriteError) {
    const key = `letter.block.${err.blocks[0] ?? err.code}`
    if (t.has(key)) return t(key as "letter.block.stale")
  }
  return t("err.save")
}

/** The letterhead: the HR establishment file first, the company profile behind it. */
export function useLetterHead(access: HrAccess): LetterHead {
  const { user } = useUser()
  const { profile } = useResolvedProfile(user?.uid ?? null)
  const p = (profile || {}) as { companyName?: string; crNumber?: string }
  const est = access.settings.establishment
  return { name: est.name || p.companyName || null, cr: est.cr || p.crNumber || null, mol: est.mol || null }
}

export function NewLetterDialog({ access, actor, emp, pay, onClose }: { access: HrAccess; actor: HrActor; emp: HrEmployee; pay: EmployeePay | null; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const kinds = requestableKinds(emp.status)
  const [kind, setKind] = useState<LetterKind>(kinds[0] ?? "sal")
  const [title, setTitle] = useState("")
  const [purpose, setPurpose] = useState("")
  const [addressee, setAddressee] = useState("")
  const [lang, setLang] = useState<LetterLang>(locale === "en" ? "en" : "ar")
  const [busy, setBusy] = useState(false)
  const self = emp.userId === access.ctx.uid
  const signer = (k: LetterKind) => letterSignerLevel(k, { isHrManager: self && access.ctx.roles.has("manager"), isGov: self && access.ctx.roles.has("gov") })
  // Without sight of pay the write decides whether there is a wage (RL-03).
  const hasWage = access.seesPay(emp.id) ? Boolean(pay && wageOf(pay) > 0) : true
  const blocks = letterBlocks({ kind, title, purpose, addressee, lang }, { status: emp.status, hasWage })
  const free = isFreeLetter(kind)
  const purposeHint = kind === "oth" || kind === "noc" ? kind : "std"

  const submit = async () => {
    if (!firestore || !access.orgId) return
    setBusy(true)
    try {
      await fileLetter(firestore, access.ctx, access.orgId, actor, { employeeId: emp.id, kind, title, purpose, addressee, lang })
      toast({ title: t("letter.sent", { who: t(`letter.signer.${signer(kind)}`) }) })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: letterError(t, err), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("letter.request_for", { name: emp.names?.ar ?? "" })}</DialogTitle>
          <DialogDescription>{t(free ? "letter.sub_free" : "letter.sub_std")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">{t("letter.type")}</legend>
            <div className="grid gap-2" role="radiogroup" aria-label={t("letter.type")}>
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  disabled={busy}
                  onClick={() => setKind(k)}
                  className={cn(
                    "min-h-11 rounded-lg border px-3 py-2 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60",
                    kind === k && "border-module bg-module/5"
                  )}
                >
                  <span className="block text-sm font-semibold">{t(`letter.kind.${k}`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`letter.hint.${k}`)} · {t("letter.signed_by", { who: t(`letter.signer.${signer(k)}`) })}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
          {kind === "oth" && (
            <div className="space-y-1.5">
              <Label htmlFor="lt-title">{t("letter.title_field")}</Label>
              <Input id="lt-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("letter.title_ph")} maxLength={160} disabled={busy} dir="auto" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="lt-purpose">{t(free ? "letter.purpose_req" : "letter.purpose_opt")}</Label>
            <Textarea id="lt-purpose" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t(`letter.purpose_ph.${purposeHint}`)} maxLength={2000} disabled={busy} dir="auto" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lt-to">{t("letter.addressee")}</Label>
              <Input id="lt-to" value={addressee} onChange={(e) => setAddressee(e.target.value)} placeholder={t("letter.addressee_ph")} maxLength={160} disabled={busy} dir="auto" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lt-lang">{t("letter.lang")}</Label>
              <Select value={lang} onValueChange={(v) => setLang(v as LetterLang)} disabled={busy}>
                <SelectTrigger id="lt-lang">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LETTER_LANGS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {t(`letter.lang_name.${l}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <BlockingReasons title={t("req.cannot_send")} reasons={blocks.map((b) => t(`letter.block.${b}`))} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("letter.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The signer's sheet, and the issued letter for anyone who may read it. */
export function LetterDialog({ access, actor, letter, onClose }: { access: HrAccess; actor: HrActor; letter: HrLetter; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const head = useLetterHead(access)
  const { pay, hidden } = useLetterPay(access, letter)
  const pending = letter.state === "pending"
  const empRef = useMemoFirebase(() => (firestore && pending ? doc(firestore, HR_EMPLOYEES, letter.employeeId) : null), [firestore, pending, letter.employeeId])
  const { data: empData } = useDoc(empRef)
  const emp = (empData as unknown as HrEmployee | null) ?? null
  const canSign = pending && access.allowed("letter.sign") && maySignLetter(access.ctx, letter) === null
  const { requests } = useHrRequests(access)
  const leaves = letter.kind === "emb" && canSign ? requests.filter((r) => r.kind === "leave" && r.state === "approved" && r.employeeId === letter.employeeId && r.leave && r.leave.to >= today) : []
  const [dec, setDec] = useState<"issue" | "decline">("issue")
  const [text, setText] = useState(initialLetterText(letter))
  const [reason, setReason] = useState("")
  const [travelId, setTravelId] = useState<string>("none")
  const [busy, setBusy] = useState(false)
  const paper = useRef<HTMLDivElement>(null)
  const free = isFreeLetter(letter.kind)
  const label = letterLabel(t, letter)
  const blocks = dec === "issue" ? issueBlocks(letter, { text }) : declineBlocks(letter, reason)
  const card = letter.card ?? (emp?.names ? letterCardOf(emp) : null)
  const travel = letter.travel ?? (travelId !== "none" ? (leaves.find((r) => r.id === travelId)?.leave ?? null) : null)
  const signer = letter.decision && letter.state === "issued" ? { name: letter.decision.byName, role: letter.decision.role } : canSign ? { name: actor.name, role: signingRole(access.ctx, letter) } : null
  const leaving = pending && letter.kind !== "exp" && (emp?.status === "leaving" || emp?.status === "left")

  const submit = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      if (dec === "decline") {
        await declineLetter(firestore, access.ctx, letter.id, actor, reason, { notice: { title: t("letter.pn_declined"), message: `${label} — ${reason.trim()}` } })
        toast({ title: t("letter.done_declined") })
      } else {
        const { serial } = await issueLetter(firestore, access.ctx, letter.id, actor, { text, head, travelRequestId: travelId !== "none" ? travelId : null }, { notice: (s) => ({ title: t("letter.pn_issued"), message: `${label} — ${letterNoDisplay(s, locale)}` }) })
        toast({ title: t("letter.done_issued", { serial: letterNoDisplay(serial, locale) }) })
      }
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: letterError(t, err), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const sub =
    letter.state === "issued"
      ? t("letter.issued_line", { date: hrDate(letter.issuedOn, locale), serial: letterNoDisplay(letter.serial, locale) })
      : letter.state === "declined"
        ? t("letter.state.declined")
        : t("letter.to_line", { to: letter.addressee, lang: t(`letter.lang_name.${letter.lang}`) })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle dir="auto">
            {label} — {letter.employeeName}
          </DialogTitle>
          <DialogDescription>{sub}</DialogDescription>
        </DialogHeader>

        {letter.purpose && letter.state !== "issued" && (
          <Callout tone="info" title={t("letter.asks")}>
            <span className="whitespace-pre-line" dir="auto">
              {letter.purpose}
            </span>
          </Callout>
        )}

        {canSign && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("letter.sign")}>
              {(["issue", "decline"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={dec === d}
                  disabled={busy}
                  onClick={() => setDec(d)}
                  className={cn(
                    "min-h-11 rounded-lg border px-3 py-2 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60",
                    dec === d && (d === "issue" ? "border-module bg-module/5" : "border-destructive bg-destructive/5")
                  )}
                >
                  <span className="block text-sm font-semibold">{t(d === "issue" ? "letter.decide_issue" : "letter.decide_decline")}</span>
                  <span className="block text-xs text-muted-foreground">{t(d === "issue" ? (free ? "letter.decide_issue_free" : "letter.decide_issue_std") : "letter.decide_decline_sub")}</span>
                </button>
              ))}
            </div>
            {dec === "decline" ? (
              <div className="space-y-1.5">
                <Label htmlFor="lt-reason">{t("letter.reason")}</Label>
                <Textarea id="lt-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} dir="auto" />
              </div>
            ) : (
              <>
                {free && (
                  <div className="space-y-1.5">
                    <Label htmlFor="lt-text">{t("letter.text")}</Label>
                    <Textarea id="lt-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} dir="auto" />
                    <p className="text-xs text-muted-foreground">{t("letter.text_note")}</p>
                  </div>
                )}
                {leaves.length > 0 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="lt-travel">{t("letter.travel")}</Label>
                    <Select value={travelId} onValueChange={setTravelId} disabled={busy}>
                      <SelectTrigger id="lt-travel">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("letter.travel_none")}</SelectItem>
                        {leaves.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {hrDate(r.leave!.from, locale)} → {hrDate(r.leave!.to, locale)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {letter.state === "declined" ? (
          <Callout tone="block" title={t("letter.state.declined")}>
            <span dir="auto">{letter.decision?.note ?? ""}</span>
          </Callout>
        ) : card ? (
          <div className="space-y-2">
            {pending && <p className="text-xs text-muted-foreground">{t("letter.preview")}</p>}
            <LetterInLanguage lang={letter.lang}>
              <div ref={paper}>
                <LetterDocument letter={letter} card={card} head={letter.head ?? head} pay={pay} payHidden={hidden} text={free ? (canSign ? text : (letter.text ?? letter.purpose)) : null} signer={signer} today={today} travel={travel} />
              </div>
            </LetterInLanguage>
            {hidden && <p className="text-xs text-muted-foreground">{t("letter.pay_hidden_note")}</p>}
          </div>
        ) : (
          pending && (
            <div className="flex justify-center p-6">
              <Loader2 className="animate-spin text-muted-foreground" size={22} aria-hidden="true" />
            </div>
          )
        )}

        {leaving && <Callout tone="warn">{t("letter.leaving_warn")}</Callout>}
        {canSign && <BlockingReasons title={t("req.cannot_send")} reasons={blocks.map((b) => t(`letter.block.${b}`))} />}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          {letter.state === "issued" && (
            <Button onClick={() => printLetter(paper.current, `${label} ${letter.serial ?? ""}`, letter.lang)}>
              <Printer size={16} className="me-2" aria-hidden="true" />
              {t("letter.print")}
            </Button>
          )}
          {canSign && (
            <Button onClick={() => void submit()} disabled={busy || blocks.length > 0} variant={dec === "decline" ? "destructive" : "default"}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t(dec === "decline" ? "letter.decide_decline" : "letter.decide_issue")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
