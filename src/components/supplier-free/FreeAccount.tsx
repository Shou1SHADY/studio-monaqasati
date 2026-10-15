"use client"

// Company account (PRD ACC-01…08, WF-21): seven tabs — basic data · specialties & coverage · legal verification · works ·
// ratings · general files · security. Specialties and cities decide which requests reach him and change them at once;
// "Verified" is the commercial register, the national address and the IBAN letter; the VAT number is optional (B-11);
// the sign-in mobile and the register are shown locked (ACC-05).

import { useMemo, useState, type FormEvent, type ReactNode } from "react"
import { collection, doc, query, updateDoc, where, type DocumentData, type UpdateData } from "firebase/firestore"
import { getAuth } from "firebase/auth"
import { Award, BadgeCheck, Briefcase, Building2, Check, FileText, Folder, Globe, Hash, KeyRound, Loader2, Lock, MapPin, PenLine, Plus, Shield, ShieldAlert, Star, Tag, Upload, Wallet } from "lucide-react"
import { useCollection, useFirestore, useMemoFirebase, useStorage, useUser } from "@/firebase"
import { useResolvedProfile } from "@/hooks/useResolvedProfile"
import { useToast } from "@/hooks/use-toast"
import { identityDocRef } from "@/lib/org-identity"
import { mirrorCompanyIdentity } from "@/lib/company-identity-writes"
import { PREDEFINED_CATEGORIES, SAUDI_CITIES, displayCategory, displayCity } from "@/lib/constants"
import { DOC_KEYS, docState, isVerified, profileChecks, profileFacts, profilePct, type DocKey } from "@/lib/supplier-free/profile"
import { uploadSupplierFile } from "@/lib/supplier-free/uploads"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { cn } from "@/lib/utils"
import { FreePage, Pill, docWord, useQueryState } from "./ui"
import { bareNumber } from "@/lib/supplier-free/derive"
import { deliveryReviews, type ReviewDoc } from "@/lib/supplier-free/reviews"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { useFree } from "./useFree"

const TABS = [
  ["basic", "atBasic"],
  ["specs", "atSpecs"],
  ["legal", "atLegal"],
  ["works", "atWorks"],
  ["ratings", "atRatings"],
  ["files", "atFiles"],
  ["security", "atSecurity"],
] as const

const DOC_ICON = { cr: FileText, vat: Hash, addr: MapPin, iban: Wallet, conf: Award } as const
const input = "h-10 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted/50 disabled:text-muted-foreground read-only:bg-muted/50"

function Panel({ icon: Icon, title, sub, right, children }: { icon: typeof Building2; title: string; sub?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Icon size={16} className="text-module" aria-hidden="true" />
        <h3 className="text-sm font-bold">{title}</h3>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        {right && <span className="ms-auto">{right}</span>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Stars({ v }: { v: number }) {
  return (
    <span className="inline-flex" aria-label={`${v}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={14} className={i <= Math.round(v) ? "fill-warning text-warning" : "text-muted-foreground/30"} aria-hidden="true" />
      ))}
    </span>
  )
}

export function FreeAccount() {
  const f = useFree()
  const { t, profile } = f
  const q = useQueryState()
  const tab = TABS.find(([k]) => k === q.get("tab"))?.[0] || "basic"
  if (!profile) return null
  const facts = profileFacts(profile.raw)
  const pct = profilePct(facts)
  const verified = isVerified(facts)
  const done = f.world.deals.filter((d) => d.closed && d.closed.k === "paid").length + ((profile.raw.projects as unknown[] | undefined) || []).length
  const missing = profileChecks(facts).filter((c) => !["basic", "specs"].includes(c.k) && !c.ok && c.k !== "vat" && c.k !== "conf").length

  return (
    <FreePage icon={Building2} title={t("navAccount")} description={t("pSub")}>
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-primary text-xl font-black text-primary-foreground">
            {(profile.companyName || profile.name).trim().charAt(0)}
            {verified && (
              <span className="absolute -bottom-1 -end-1 grid h-5 w-5 place-items-center rounded-full bg-success text-white">
                <Shield size={11} aria-hidden="true" />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 basis-60">
            <h2 className="text-lg font-black" dir="auto">
              {profile.companyName || profile.name}
            </h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {verified ? <Pill tone="ok" dot>{t("verifiedLong")}</Pill> : <Pill tone="mute">{t("notVerified")}</Pill>}
              {profile.email && <Pill tone="mute"><bdi>{profile.email}</bdi></Pill>}
              {profile.phone && <Pill tone="mute"><bdi>{profile.phone}</bdi></Pill>}
              {profile.city && <Pill tone="mute">{displayCity(profile.city, f.locale)}</Pill>}
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{t("statPct")}</dt>
              <dd className="text-lg font-black tabular-nums" dir="ltr">{pct}%</dd>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-cta" style={{ width: `${pct}%` }} /></span>
            </div>
            <div className="rounded-lg border px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{t("statDone")}</dt>
              <dd className="text-lg font-black tabular-nums" dir="ltr">{done}</dd>
            </div>
            <RatingStat />
          </dl>
        </div>
      </section>

      <SegmentedNav
        ariaLabel={t("navAccount")}
        active={tab}
        onSelect={(id) => q.set({ tab: id === "basic" ? "" : id })}
        segments={TABS.map(([k, l]) => ({ id: k, label: t(l), count: k === "legal" && missing ? missing : undefined, tone: k === "legal" ? ("warn" as const) : undefined }))}
      />

      {tab === "basic" && <BasicTab />}
      {tab === "specs" && <SpecsTab />}
      {tab === "legal" && <LegalTab verified={verified} />}
      {tab === "works" && <WorksTab />}
      {tab === "ratings" && <RatingsTab />}
      {tab === "files" && <FilesTab />}
      {tab === "security" && <SecurityTab />}
    </FreePage>
  )
}

// ---- Hooks shared by the tabs -----------------------------------------------------------------------------------

function useIdentityWriter() {
  const firestore = useFirestore()
  const { user } = useUser()
  const { organizationId, isSecondary } = useResolvedProfile(user?.uid)
  return async (payload: Record<string, unknown>) => {
    if (!firestore || !user) return
    const ref = isSecondary ? identityDocRef(firestore, organizationId) : doc(firestore, "users", user.uid)
    await updateDoc(ref, payload as UpdateData<DocumentData>)
    void mirrorCompanyIdentity(firestore, organizationId || user.uid, payload)
  }
}

/** The contractors' ratings of him, each tied to a completed delivery of his and naming its material (ACC-07). */
function useReviews(orgId: string | undefined, pos: PurchaseOrder[]) {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "reviews"), where("revieweeId", "==", orgId)) : null), [firestore, orgId])
  const { data } = useCollection<ReviewDoc>(q)
  return useMemo(() => deliveryReviews(data || [], pos), [data, pos])
}

function RatingStat() {
  const f = useFree()
  const reviews = useReviews(f.profile?.orgId, f.pos)
  const avg = reviews.length ? Math.round((reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length) * 10) / 10 : null
  return (
    <div className="rounded-lg border px-3 py-2">
      <dt className="text-[11px] text-muted-foreground">{f.t("statRate")}</dt>
      <dd className="text-lg font-black tabular-nums" dir="ltr">{avg ?? "—"}</dd>
      {avg != null && <Stars v={avg} />}
    </div>
  )
}

// ---- Basic data ------------------------------------------------------------------------------------------------------

function BasicTab() {
  const f = useFree()
  const { t, profile } = f
  const save = useIdentityWriter()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const raw = (profile?.raw || {}) as Record<string, unknown>
  const [tax, setTax] = useState(String(raw.taxNumber || ""))
  const [email, setEmail] = useState(String(raw.email || profile?.email || ""))
  const [city, setCity] = useState(String(raw.city || ""))
  const [addr, setAddr] = useState(String(raw.nationalAddress || raw.location || ""))
  const [about, setAbout] = useState(String(raw.description || ""))
  if (!profile) return null
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await save({ taxNumber: tax.trim(), city, location: addr.trim(), nationalAddress: addr.trim(), description: about.trim() })
      if (firestore && user && email.trim() !== profile.email) await updateDoc(doc(firestore, "users", user.uid), { email: email.trim() }).catch(() => undefined)
      toast({ title: t("tSaved") })
    } catch (err) {
      console.error(err)
      toast({ title: t("errSave"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit}>
      <Panel icon={Building2} title={t("abContactT")} sub={t("abContactSub")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            {t("fCo")} <span className="text-destructive">*</span>
            <input className={`${input} mt-1`} value={profile.companyName} readOnly />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{t("abNameHint")}</span>
          </label>
          <label className="block text-sm font-semibold">
            {t("fCR")} <span className="text-destructive">*</span>
            <input className={`${input} mt-1`} dir="ltr" value={String(raw.crNumber || "")} readOnly />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{t("abNameHint")}</span>
          </label>
          <label className="block text-sm font-semibold">
            {t("fMob")} <span className="text-destructive">*</span>
            <input className={`${input} mt-1`} dir="ltr" value={profile.phone} readOnly />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{t("abMobHint")}</span>
          </label>
          <label className="block text-sm font-semibold">
            {t("fVAT")}
            <input className={`${input} mt-1`} dir="ltr" inputMode="numeric" value={tax} onChange={(e) => setTax(e.target.value)} />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{t("abVatHint")}</span>
          </label>
          <label className="block text-sm font-semibold">
            {t("fEmail")}
            <input type="email" className={`${input} mt-1`} dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold">
            {t("fCity")} <span className="text-destructive">*</span>
            <NativeSelect className={`${input} mt-1`} value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="" />
              {SAUDI_CITIES.map((c) => (
                <option key={c} value={c}>
                  {displayCity(c, f.locale)}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
        <label className="mt-4 block text-sm font-semibold">
          {t("fAddress")} <span className="text-destructive">*</span>
          <input className={`${input} mt-1`} value={addr} onChange={(e) => setAddr(e.target.value)} />
        </label>
        <label className="mt-4 block text-sm font-semibold">
          {t("abAbout")}
          <textarea rows={3} placeholder={t("abAboutPh")} className={`${input} mt-1 h-auto py-2`} value={about} onChange={(e) => setAbout(e.target.value)} />
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">{t("abSaveHint")}</span>
          <Button type="submit" disabled={busy} className="ms-auto bg-cta text-cta-foreground hover:bg-cta/90">
            {busy ? <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" /> : <Check size={15} className="me-1.5" aria-hidden="true" />}
            {t("saveChanges")}
          </Button>
        </div>
      </Panel>
    </form>
  )
}

// ---- Specialties and coverage --------------------------------------------------------------------------------------------

function SpecsTab() {
  const f = useFree()
  const { t, profile, L } = f
  const [edit, setEdit] = useState(false)
  if (!profile) return null
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel icon={Tag} title={t("asSpecsT")} sub={t("asSpecsSub")}>
        <h4 className="mb-1.5 text-sm font-bold">{t("pSpecsL")}</h4>
        <div className="flex flex-wrap gap-1.5">
          {profile.specializations.length ? profile.specializations.map((c) => <Pill key={c} tone="module">{displayCategory(c, f.locale)}</Pill>) : <span className="text-xs text-muted-foreground">—</span>}
        </div>
        <h4 className="mb-1.5 mt-4 text-sm font-bold">{t("pCities")}</h4>
        <div className="flex flex-wrap gap-1.5">
          {profile.coverageCities.length ? profile.coverageCities.map((c) => <Pill key={c} tone="mute">{displayCity(c, f.locale)}</Pill>) : <span className="text-xs text-muted-foreground">—</span>}
        </div>
        <Button type="button" size="sm" className="mt-4 bg-cta text-cta-foreground hover:bg-cta/90" onClick={() => setEdit(true)}>
          <PenLine size={14} className="me-1.5" aria-hidden="true" />
          {t("pSpecsReq")}
        </Button>
      </Panel>
      <Panel icon={Globe} title={t("asWhyT")}>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("asWhyX")}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg border px-3 py-2"><dt className="text-[11px] text-muted-foreground">{t("okOpen")}</dt><dd className="text-lg font-black tabular-nums" dir="ltr">{L.opps({}).length}</dd></div>
          <div className="rounded-lg border px-3 py-2"><dt className="text-[11px] text-muted-foreground">{t("otInvite")}</dt><dd className="text-lg font-black tabular-nums" dir="ltr">{L.opps({ tab: "invite" }).length}</dd></div>
        </dl>
      </Panel>
      {edit && <SpecsDialog onClose={() => setEdit(false)} />}
    </div>
  )
}

function SpecsDialog({ onClose }: { onClose: () => void }) {
  const f = useFree()
  const { t, profile } = f
  const { toast } = useToast()
  const [specs, setSpecs] = useState<string[]>(profile?.specializations || [])
  const [cities, setCities] = useState<string[]>(profile?.coverageCities || [])
  const [busy, setBusy] = useState(false)
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const block = !specs.length || !cities.length ? t("blkSpecs") : ""
  const submit = async () => {
    setBusy(true)
    try {
      const token = await getAuth().currentUser?.getIdToken()
      const res = await fetch("/api/supplier-free/specialties", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ specializations: specs, coverageCities: cities }) })
      if (!res.ok) throw new Error(String(res.status))
      toast({ title: t("tSpecs") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t("errSave"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  const chip = (on: boolean) => cn("inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold", on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("mSpecsT")}</DialogTitle>
          <DialogDescription>{t("mSpecsSub")}</DialogDescription>
        </DialogHeader>
        <h4 className="text-sm font-bold">{t("pSpecsL")}</h4>
        <div className="flex flex-wrap gap-1.5">
          {PREDEFINED_CATEGORIES.map((c) => (
            <button key={c} type="button" aria-pressed={specs.includes(c)} onClick={() => toggle(specs, setSpecs, c)} className={chip(specs.includes(c))}>
              {displayCategory(c, f.locale)}
            </button>
          ))}
        </div>
        <h4 className="mt-2 text-sm font-bold">{t("pCities")}</h4>
        <div className="flex flex-wrap gap-1.5">
          {SAUDI_CITIES.map((c) => (
            <button key={c} type="button" aria-pressed={cities.includes(c)} onClick={() => toggle(cities, setCities, c)} className={chip(cities.includes(c))}>
              {displayCity(c, f.locale)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <p className="flex-1 text-xs font-semibold text-destructive">{block}</p>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("cancel")}</Button>
          <Button onClick={() => void submit()} disabled={!!block || busy} className="bg-cta text-cta-foreground hover:bg-cta/90">
            {busy && <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("btnSpecsSend")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---- Legal verification ----------------------------------------------------------------------------------------------------

function LegalTab({ verified }: { verified: boolean }) {
  const f = useFree()
  const { t, profile, today, fmt } = f
  const storage = useStorage()
  const save = useIdentityWriter()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [expiry, setExpiry] = useState<Record<string, string>>({})
  if (!profile) return null
  const facts = profileFacts(profile.raw)
  const upload = async (k: DocKey, file: File) => {
    if (!storage) return
    setBusy(k)
    try {
      const up = await uploadSupplierFile(storage, profile.orgId, "documents", file)
      if (k === "conf") {
        await save({ certificates: [...(facts.certificates || []), { name: file.name, url: up.url, expiryDate: expiry[k] || "" }] })
      } else {
        await save({ [`legalDocuments.${k}`]: { url: up.url, name: file.name, expiryDate: expiry[k] || facts.legalDocuments?.[k]?.expiryDate || "" } })
      }
      toast({ title: t("tDoc") })
    } catch (err) {
      console.error(err)
      toast({ title: t("errSave"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Panel icon={Shield} title={t("alDocsT")} sub={t("alDocsSub")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {DOC_KEYS.map((k) => {
            const Icon = DOC_ICON[k]
            const d = k === "conf" ? (facts.certificates || [])[0] : facts.legalDocuments?.[k]
            const has = !!d && !!d.url
            const exp = (d as { expiryDate?: string } | undefined)?.expiryDate
            const state = docState(exp, today)
            return (
              <div key={k} className="rounded-xl border p-3">
                <div className="flex items-start gap-2.5">
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", has ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <b className="block text-sm">{t(`doc_${k}`)}</b>
                    <span className="block truncate text-xs text-muted-foreground">{has ? <bdi>{(d as { name?: string }).name}</bdi> : t(`docWhy_${k}`)}</span>
                  </div>
                  {has ? state === "soon" || state === "expired" ? <Pill tone="warn">{t("docSoon")}</Pill> : <Pill tone="ok">{t("docValid")}</Pill> : <Pill tone="bad">{t("missing")}</Pill>}
                </div>
                {(k === "cr" || k === "vat" || k === "conf") && (
                  <label className="mt-2 block text-xs font-semibold">
                    {t("docExp")}
                    <input type="date" className={`${input} mt-1 h-9`} value={expiry[k] ?? exp ?? ""} onChange={(e) => setExpiry((x) => ({ ...x, [k]: e.target.value }))} />
                  </label>
                )}
                {exp && <p className="mt-1 text-xs text-muted-foreground">{t("docExp")}: {fmt.date(exp, true)}</p>}
                <div className="mt-2 flex items-center gap-2">
                  <input id={`doc-${k}`} type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(k, e.target.files[0])} />
                  <label htmlFor={`doc-${k}`} className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-bold", has ? "border bg-card hover:bg-muted/50" : "bg-cta text-cta-foreground hover:bg-cta/90")}>
                    {busy === k ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Upload size={13} aria-hidden="true" />}
                    {has ? t("docUpdate") : t("upload")}
                  </label>
                  {has && <span className="text-xs text-muted-foreground">{t("docSeen")}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </Panel>
      <Panel icon={BadgeCheck} title={t("alStateT")}>
        {verified ? (
          <Callout tone="info"><b>{t("alVerified")}</b> — {t("alVerifiedX")}</Callout>
        ) : (
          <Callout tone="warn"><b>{t("alNotVerified")}</b> — {t("alNotVerifiedX")}</Callout>
        )}
        <h4 className="mb-1.5 mt-4 text-sm font-bold">{t("alPerks")}</h4>
        <ul className="space-y-1.5 text-sm">
          {["alPerk1", "alPerk2", "alPerk3"].map((k) => (
            <li key={k} className="flex gap-2"><Check size={14} className="mt-1 shrink-0 text-success" aria-hidden="true" />{t(k as "alPerk1")}</li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

// ---- Works and certificates ----------------------------------------------------------------------------------------------------

function WorksTab() {
  const f = useFree()
  const { t, profile, world, fmt, L } = f
  const save = useIdentityWriter()
  const { toast } = useToast()
  const [dlg, setDlg] = useState<"work" | "cert" | null>(null)
  if (!profile) return null
  const raw = profile.raw
  const works = ((raw.projects as { name?: string; client?: string; year?: number | string; value?: string }[] | undefined) || []).filter((w) => w && w.name)
  const certs = ((raw.certificates as { name?: string; expiryDate?: string }[] | undefined) || []).filter((c) => c && c.name)
  const onMdmak = world.deals.filter((d) => d.closed && d.closed.k === "paid")
  const add = async (kind: "work" | "cert", v: Record<string, string>) => {
    try {
      if (kind === "work") await save({ projects: [...works, { name: v.name, client: v.client, year: v.year, value: v.value }] })
      else await save({ certificates: [...(((raw.certificates as unknown[]) || []) as object[]), { name: v.name, expiryDate: v.exp }] })
      toast({ title: t("tSaved") })
      setDlg(null)
    } catch {
      toast({ title: t("errSave"), variant: "destructive" })
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel icon={Briefcase} title={t("awT")} sub={t("awSub")} right={<button type="button" onClick={() => setDlg("work")} className="inline-flex items-center gap-1 text-xs font-bold text-module"><Plus size={14} aria-hidden="true" />{t("awAdd")}</button>}>
        {works.length ? (
          <ul className="divide-y">
            {works.map((w, i) => (
              <li key={i} className="py-2.5 text-sm"><b dir="auto">{w.name}</b><span className="block text-xs text-muted-foreground"><bdi>{w.client}</bdi> · {w.year}{w.value ? ` · ${w.value}` : ""}</span></li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Briefcase} title={t("awEmpty")} />
        )}
      </Panel>
      <div className="space-y-4">
        <Panel icon={Check} title={t("awOnT")} sub={t("awOnSub")}>
          {onMdmak.length ? (
            <>
              <ul className="divide-y">
                {onMdmak.map((d) => (
                  <li key={d.id} className="py-2.5 text-sm"><b dir="auto">{d.title}</b><span className="block text-xs text-muted-foreground"><bdi>{L.C(d.c)?.name}</bdi> · {fmt.date(d.closed?.at, true)}</span></li>
                ))}
              </ul>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Lock size={12} aria-hidden="true" />{t("awPrivacy")}</p>
            </>
          ) : (
            <EmptyState icon={Check} title={t("awOnEmpty")} />
          )}
        </Panel>
        <Panel icon={Award} title={t("acT")} sub={t("acSub")} right={<button type="button" onClick={() => setDlg("cert")} className="inline-flex items-center gap-1 text-xs font-bold text-module"><Plus size={14} aria-hidden="true" />{t("acAdd")}</button>}>
          {certs.length ? (
            <ul className="divide-y">
              {certs.map((c, i) => (
                <li key={i} className="py-2.5 text-sm"><b dir="auto">{c.name}</b>{c.expiryDate && <span className="block text-xs text-muted-foreground">{t("expires", { x: fmt.date(c.expiryDate, true) })}</span>}</li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Award} title={t("acEmpty")} />
          )}
        </Panel>
      </div>
      {dlg && <EntryDialog kind={dlg} onClose={() => setDlg(null)} onSave={(v) => void add(dlg, v)} />}
    </div>
  )
}

function EntryDialog({ kind, onClose, onSave }: { kind: "work" | "cert"; onClose: () => void; onSave: (v: Record<string, string>) => void }) {
  const { t } = useFree()
  const [v, setV] = useState<Record<string, string>>({})
  const block = !(v.name || "").trim() ? t(kind === "work" ? "blkWorkName" : "blkCertName") : ""
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(kind === "work" ? "awAdd" : "acAdd")}</DialogTitle>
          <DialogDescription>{t(kind === "work" ? "awAddSub" : "acSub")}</DialogDescription>
        </DialogHeader>
        <label className="block text-sm font-semibold">{t(kind === "work" ? "awName" : "acName")} <span className="text-destructive">*</span><input className={`${input} mt-1`} value={v.name || ""} onChange={(e) => set("name", e.target.value)} /></label>
        {kind === "work" ? (
          <>
            <label className="block text-sm font-semibold">{t("awClient")}<input className={`${input} mt-1`} value={v.client || ""} onChange={(e) => set("client", e.target.value)} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-semibold">{t("awYear")}<input className={`${input} mt-1`} inputMode="numeric" value={v.year || ""} onChange={(e) => set("year", e.target.value)} /></label>
              <label className="block text-sm font-semibold">{t("awValue")}<input className={`${input} mt-1`} placeholder={t("awValuePh")} value={v.value || ""} onChange={(e) => set("value", e.target.value)} /></label>
            </div>
          </>
        ) : (
          <label className="block text-sm font-semibold">{t("docExp")}<input type="date" className={`${input} mt-1`} value={v.exp || ""} onChange={(e) => set("exp", e.target.value)} /></label>
        )}
        <div className="flex items-center gap-3 border-t pt-3">
          <p className="flex-1 text-xs font-semibold text-destructive">{block}</p>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          <Button disabled={!!block} onClick={() => onSave(v)} className="bg-cta text-cta-foreground hover:bg-cta/90">{t("save")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---- Ratings --------------------------------------------------------------------------------------------------------------------

function RatingsTab() {
  const f = useFree()
  const { t, profile, fmt, pos } = f
  const reviews = useReviews(profile?.orgId, pos)
  const avg = reviews.length ? Math.round((reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length) * 10) / 10 : 0
  const rated = pos.filter((p) => p.rating)
  const crit = useMemo(() => {
    if (!rated.length) return null
    const mean = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10
    return {
      onTime: mean(rated.map((p) => (p.rating?.onTime === false ? 2 : 5))),
      quality: mean(rated.map((p) => p.rating?.conformity || 0)),
      response: mean(rated.map((p) => p.rating?.cooperation || 0)),
    }
  }, [rated])
  if (!reviews.length) return <EmptyState icon={Star} title={t("noRatingsShort")} description={t("noRatingsX")} />
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Panel icon={Star} title={t("arT")} sub={t("arSub")}>
        <ul className="divide-y">
          {reviews.map((r, i) => (
            <li key={i} className="py-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Stars v={r.rating || 0} /><span>{r.reviewerName ? <bdi>{r.reviewerName}</bdi> : null} · {fmt.date((r.createdAt || "").slice(0, 10), true)}</span></div>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("arFor", { m: r.material, po: docWord(f, "po", bareNumber(r.poNumber)) })}</p>
              {r.comment && <p className="mt-1 text-sm" dir="auto">{r.comment}</p>}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel icon={Award} title={t("arSumT")}>
        <div className="flex items-center gap-3"><b className="text-3xl font-black tabular-nums" dir="ltr">{avg}</b><div><Stars v={avg} /><p className="text-xs text-muted-foreground">{t("ratingsN", { n: reviews.length })}</p></div></div>
        {crit && (
          <div className="mt-4 space-y-2">
            {(["onTime", "quality", "response"] as const).map((k) => (
              <div key={k} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{t(`crit_${k}`)}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-success" style={{ width: `${(crit[k] / 5) * 100}%` }} /></span>
                <b className="tabular-nums" dir="ltr">{crit[k]}</b>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

// ---- General files -----------------------------------------------------------------------------------------------------------------

function FilesTab() {
  const f = useFree()
  const { t, profile, fmt } = f
  const storage = useStorage()
  const save = useIdentityWriter()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  if (!profile) return null
  const files = ((profile.raw.companyFiles as { name?: string; url?: string; size?: string; at?: string }[] | undefined) || []).filter((x) => x && x.name)
  const upload = async (file: File) => {
    if (!storage) return
    setBusy(true)
    try {
      const up = await uploadSupplierFile(storage, profile.orgId, "files", file)
      await save({ companyFiles: [...files, { name: file.name, url: up.url, size: `${Math.max(1, Math.round(file.size / 1024))} KB`, at: f.today }] })
      toast({ title: t("tDoc") })
    } catch {
      toast({ title: t("errSave"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel
      icon={Folder}
      title={t("afT")}
      sub={t("afSub")}
      right={
        <>
          <input id="gfile" type="file" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <label htmlFor="gfile" className="inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-module">{busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}{t("afUpload")}</label>
        </>
      }
    >
      {files.length ? (
        <ul className="divide-y">
          {files.map((x, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <a href={x.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-bold hover:text-module"><bdi>{x.name}</bdi></a>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{x.size} · {fmt.date(x.at, true)}<Pill tone="mute">{t("afShared")}</Pill></span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Folder} title={t("afEmpty")} />
      )}
    </Panel>
  )
}

// ---- Security and privacy ------------------------------------------------------------------------------------------------------------

function SecurityTab() {
  const f = useFree()
  const { t, profile } = f
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const raw = (profile?.raw || {}) as Record<string, unknown>
  const [flags, setFlags] = useState({ twoFactorEnabled: !!raw.twoFactorEnabled, showPhone: raw.showPhone !== false, emailNotif: raw.emailNotif !== false })
  if (!profile) return null
  const set = async (k: keyof typeof flags, v: boolean) => {
    setFlags((x) => ({ ...x, [k]: v }))
    if (!firestore || !user) return
    try {
      await updateDoc(doc(firestore, "users", user.uid), { [k]: v })
    } catch {
      setFlags((x) => ({ ...x, [k]: !v }))
      toast({ title: t("errSave"), variant: "destructive" })
    }
  }
  const rows: [keyof typeof flags, string, string][] = [
    ["twoFactorEnabled", "asec2", "asec2X"],
    ["showPhone", "asecPhone", "asecPhoneX"],
    ["emailNotif", "asecMail", "asecMailX"],
  ]
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel icon={Lock} title={t("asecT")} sub={t("asecSub")}>
        <div className="flex items-center justify-between gap-3 border-b py-3">
          <div><b className="text-sm">{t("asecLogin")}</b><p className="text-xs text-muted-foreground">{t("asecLoginX", { m: profile.phone })}</p></div>
          <Pill tone="ok" dot>{t("active")}</Pill>
        </div>
        {rows.map(([k, a, b]) => (
          <div key={k} className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0">
            <div><b className="text-sm">{t(a as "asec2")}</b><p className="text-xs text-muted-foreground">{t(b as "asec2X")}</p></div>
            <Switch checked={flags[k]} onCheckedChange={(v) => void set(k, v)} aria-label={t(a as "asec2")} />
          </div>
        ))}
      </Panel>
      <Panel icon={KeyRound} title={t("asecSessT")}>
        <div className="flex items-center gap-3 text-sm">
          <Globe size={18} className="text-cta" aria-hidden="true" />
          <div className="flex-1"><b>{t("asecSess1")}</b><p className="text-xs text-muted-foreground">{t("asecSess1X")}</p></div>
          <Pill tone="ok" dot>{t("now")}</Pill>
        </div>
        <p className="mt-4 flex gap-2 text-xs text-muted-foreground"><ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{t("abMobHint")}</p>
      </Panel>
    </div>
  )
}

