"use client"

// The opportunity's journey dialogs (Opportunity journey v1.1): «we do not bid», «ask Sales for a quotation», «ask for
// a revised version», «record the award», and the optional estimate. Co-located because they share one contract: each
// records a fact in the name of whoever acts, through `crm-opportunity-writes`.

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { Coins, RefreshCcw, Send, Trophy, XCircle } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Chip } from "@/components/module-ui/Chip"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { CrmFormDialog, RequiredMark } from "@/components/crm/CrmFormDialog"
import { OfferPdfButton } from "@/components/crm/OfferPdfButton"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import {
  CRM_OPPORTUNITIES,
  NO_GO_REASONS,
  WON_REASONS,
  formatCrmDate,
  formatSar,
  opportunityDeliverables,
  type CrmContact,
  type CrmOpportunity,
  type CrmQuotation,
  type NoGoReason,
  type WonReason,
} from "@/lib/crm"
import {
  recordAward,
  recordNoGo,
  requestPricing,
  requestRevision,
  type OppActor,
  type OpportunityFile,
} from "@/lib/crm-opportunity-writes"
import { displayDocNumber } from "@/lib/sales-numbering"
import { DATE_INPUT_CLASS } from "@/components/crm/CrmOpportunityDialog"
import { iso, ltr } from "@/components/crm/OppBits"

type Base = { open: boolean; onOpenChange: (open: boolean) => void; opp: CrmOpportunity; actor: OppActor }

/** «We do not bid» (OPP-03 #3): a reason, an optional note — and the deal closes «lost · we withdrew». */
export function NoGoDialog({ open, onOpenChange, opp, actor }: Base) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [reason, setReason] = useState<NoGoReason | "">("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      setReason("")
      setNote("")
    }
  }, [open])

  const save = async () => {
    if (!firestore || !reason) return
    setSaving(true)
    try {
      await recordNoGo(firestore, opp, actor, reason, note)
      toast({ title: t("crm_nogo_done") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={XCircle}
      title={t("crm_nogo_title")}
      steps={[
        {
          id: "nogo",
          title: t("crm_nogo_title"),
          validate: () => (reason ? null : t("crm_nogo_reason_required")),
          content: (
            <>
              <div className="space-y-1.5">
                <Label>
                  {t("crm_nogo_reason")} <RequiredMark />
                </Label>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t("crm_nogo_reason")}>
                  {NO_GO_REASONS.map((r) => (
                    <Chip key={r} selected={reason === r} onClick={() => setReason(r)}>
                      {t(`crm_nogo_reason_${r}`)}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nogo-note">{t("crm_note")}</Label>
                <Textarea id="nogo-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} />
                <p className="text-[11px] text-muted-foreground">{t("crm_nogo_hint")}</p>
              </div>
            </>
          ),
        },
      ]}
      isSaving={saving}
      submitLabel={t("crm_nogo_submit")}
      onSubmit={() => void save()}
    />
  )
}

/**
 * «Ask Sales for a quotation» (OPP-04 #3): shows what will be sent — the deal's number, client, what we deliver, the
 * deadline — and lets the person pick the files to send and leave a note for the pricer.
 */
export function PricingRequestDialog({ open, onOpenChange, opp, actor, files }: Base & { files: OpportunityFile[] }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      // Everything but the photos goes by default — the pricer needs the documents; photos are a choice.
      setPicked(files.filter((f) => f.kind !== "site_photos").map((f) => f.id))
      setNote("")
    }
  }, [open, files])

  const save = async () => {
    if (!firestore) return
    setSaving(true)
    try {
      const params = { number: displayDocNumber(opp.docNumber, locale) || opp.title, title: opp.title, contact: opp.contactName || "—" }
      const number = await requestPricing(firestore, opp, actor, {
        files: files.filter((f) => picked.includes(f.id)),
        note,
        notification: {
          title: t("crm_price_notif_title"),
          message: t("crm_price_notif_msg", params),
          i18n: { title: "crm_price_notif_title", message: "crm_price_notif_msg", params },
        },
      })
      toast({ title: t("crm_price_sent", { number: iso(displayDocNumber(number, locale)) }) })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const rows: Array<[string, string]> = [
    [t("crm_opp_label"), [displayDocNumber(opp.docNumber, locale), opp.title].filter(Boolean).join(" · ")],
    [t("crm_client"), opp.contactName || "—"],
    [t("crm_deliverable"), opportunityDeliverables(opp).map((d) => t(`crm_deliverable_${d}`)).join(" · ")],
    [t("crm_track_date_tender"), opp.expectedCloseDate ? formatCrmDate(opp.expectedCloseDate, locale) : t("crm_not_set")],
  ]

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Send}
      title={t("crm_price_title")}
      description={t("crm_price_desc")}
      steps={[
        {
          id: "price",
          title: t("crm_price_title"),
          content: (
            <>
              <dl className="divide-y rounded-lg border text-sm">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-end font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="space-y-1.5">
                <Label>{t("crm_price_files")}</Label>
                {files.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("crm_price_no_files")}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {files.map((f) => (
                      <li key={f.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id={`pf-${f.id}`}
                          checked={picked.includes(f.id)}
                          onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, f.id] : p.filter((x) => x !== f.id)))}
                        />
                        <Label htmlFor={`pf-${f.id}`} className="cursor-pointer font-normal">
                          <bdi dir="auto">{f.name}</bdi>
                          <span className="ms-2 text-[11px] text-muted-foreground">{t(`crm_file_kind_${f.kind}`)}</span>
                        </Label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="price-note">{t("crm_price_note")}</Label>
                <Textarea id="price-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} />
              </div>
            </>
          ),
        },
      ]}
      isSaving={saving}
      submitLabel={t("crm_price_submit")}
      onSubmit={() => void save()}
    />
  )
}

/** «Ask for a revised version» (OPP-04 #7): what the client asks, and by when — on the same offer; the deal moves to
 * «negotiation». */
export function RevisionRequestDialog({ open, onOpenChange, opp, actor, offer }: Base & { offer: CrmQuotation }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [ask, setAsk] = useState("")
  const [due, setDue] = useState("")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      setAsk("")
      setDue("")
    }
  }, [open])

  const save = async () => {
    if (!firestore || !ask.trim()) return
    setSaving(true)
    try {
      const params = { number: displayDocNumber(offer.quotationNumber, locale), title: opp.title }
      await requestRevision(firestore, opp, actor, offer, {
        ask,
        dueDate: due || null,
        notification: {
          title: t("crm_revision_notif_title"),
          message: t("crm_revision_notif_msg", params),
          i18n: { title: "crm_revision_notif_title", message: "crm_revision_notif_msg", params },
        },
      })
      toast({ title: t("crm_revision_sent") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={RefreshCcw}
      title={t("crm_revision_title")}
      description={t("crm_revision_desc", { number: iso(displayDocNumber(offer.quotationNumber, locale)) })}
      steps={[
        {
          id: "revision",
          title: t("crm_revision_title"),
          validate: () => (ask.trim() ? null : t("crm_revision_ask_required")),
          content: (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="rev-ask">
                  {t("crm_revision_ask")} <RequiredMark />
                </Label>
                <Textarea id="rev-ask" value={ask} onChange={(e) => setAsk(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rev-due">{t("crm_revision_due")}</Label>
                <input id="rev-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} dir="ltr" className={DATE_INPUT_CLASS} disabled={saving} />
              </div>
            </>
          ),
        },
      ]}
      isSaving={saving}
      submitLabel={t("crm_revision_submit")}
      onSubmit={() => void save()}
    />
  )
}

/**
 * «Record the award» (OPP-06): the value starts from the last offer Sales sent, with its PDF; lowering it marks a
 * partial award. «Bidders (with us)» of 1 picks «sole bidder» by itself. Sales hears the outcome.
 */
export function AwardDialog({ open, onOpenChange, opp, actor, offer, contact }: Base & { offer: CrmQuotation | null; contact: CrmContact | null }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const base = offer?.amount || opp.submittedPrice || 0
  const [value, setValue] = useState("")
  const [bidders, setBidders] = useState("")
  const [rank, setRank] = useState("1")
  const [reason, setReason] = useState<WonReason | "">("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) {
      setValue(base ? String(base) : "")
      setBidders(opp.bidderCount != null ? String(opp.bidderCount) : "")
      setRank(opp.ourRank != null ? String(opp.ourRank) : "1")
      setReason(opp.wonReason ?? "")
      setNote(opp.wonNote ?? "")
    }
  }, [open, base, opp])
  // One bidder — us — is a reason in itself.
  useEffect(() => {
    if (bidders === "1") setReason("sole_bidder")
  }, [bidders])

  const amount = Number(value)
  const partial = base > 0 && amount > 0 && amount < base

  const save = async () => {
    if (!firestore || !reason || !(amount > 0)) return
    setSaving(true)
    try {
      const params = {
        number: displayDocNumber(opp.docNumber, locale) || opp.title,
        title: opp.title,
        offer: offer ? displayDocNumber(offer.quotationNumber, locale) : "—",
      }
      const projectDeal = opportunityDeliverables(opp).includes("project")
      const key = projectDeal ? "crm_award_notif_project" : "crm_award_notif_order"
      await recordAward(firestore, opp, actor, offer, {
        value: amount,
        bidderCount: bidders ? Number(bidders) : null,
        ourRank: rank ? Number(rank) : null,
        reason,
        note,
        notice: { title: t("crm_award_notif_title"), message: t(key, params), i18n: { title: "crm_award_notif_title", message: key, params } },
      })
      toast({ title: t("crm_award_saved") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Trophy}
      title={t("crm_award_title")}
      description={t("crm_award_desc")}
      steps={[
        {
          id: "award",
          title: t("crm_award_title"),
          validate: () => (!(amount > 0) ? t("crm_award_value_required") : !reason ? t("crm_won_reason_required") : null),
          content: (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="award-value">
                  {t("crm_award_value")} <RequiredMark />
                </Label>
                <div className="flex items-center gap-2">
                  <Input id="award-value" type="number" min="0" step="any" inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} disabled={saving} className="flex-1" />
                  {offer && <OfferPdfButton quote={offer} contact={contact} />}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {partial ? t("crm_award_partial_hint", { offer: ltr(formatSar(base, locale)) }) : t("crm_award_value_hint")}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="award-bidders">{t("crm_award_bidders")}</Label>
                  <Input id="award-bidders" type="number" min="1" step="1" inputMode="numeric" dir="ltr" value={bidders} onChange={(e) => setBidders(e.target.value)} disabled={saving} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="award-rank">{t("crm_value_rank")}</Label>
                  <Input id="award-rank" type="number" min="1" step="1" inputMode="numeric" dir="ltr" value={rank} onChange={(e) => setRank(e.target.value)} disabled={saving} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="award-reason">
                  {t("crm_won_reason")} <RequiredMark />
                </Label>
                <NativeSelect id="award-reason" className="w-full" value={reason} onChange={(e) => setReason(e.target.value as WonReason)} disabled={saving}>
                  <option value="" disabled>
                    {t("crm_pick")}
                  </option>
                  {WON_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`crm_won_reason_${r}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="award-note">{t("crm_award_what_happened")}</Label>
                <Textarea id="award-note" value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} />
              </div>
            </>
          ),
        },
      ]}
      isSaving={saving}
      submitLabel={t("crm_save")}
      onSubmit={() => void save()}
    />
  )
}

/** The optional estimate (OPP-03 #1): «leave it empty until you have something to build it on» — never shown to the
 * client; the price comes from Sales. Clearing it is allowed. */
export function EstimateDialog({ open, onOpenChange, opp }: Omit<Base, "actor">) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) setValue(opp.value > 0 ? String(opp.value) : "")
  }, [open, opp.value])

  const save = async () => {
    if (!firestore) return
    const n = Number(value)
    setSaving(true)
    try {
      await updateDoc(doc(firestore, CRM_OPPORTUNITIES, opp.id), { value: Number.isFinite(n) && n > 0 ? n : 0, updatedAt: serverTimestamp() })
      toast({ title: t("crm_saved") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Coins}
      title={t("crm_value_estimate_label")}
      steps={[
        {
          id: "estimate",
          title: t("crm_value_estimate_label"),
          content: (
            <div className="space-y-1.5">
              <Label htmlFor="est-value">{t("crm_estimate_optional")}</Label>
              <Input id="est-value" type="number" min="0" step="any" inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} disabled={saving} />
              <p className="text-[11px] text-muted-foreground">{t("crm_estimate_hint")}</p>
            </div>
          ),
        },
      ]}
      isSaving={saving}
      submitLabel={t("crm_save")}
      onSubmit={() => void save()}
    />
  )
}

