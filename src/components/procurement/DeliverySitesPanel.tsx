"use client"

// Settings → «مواقع التسليم» (Procurement 1.5, PUR-10): where goods go, in every package —
// warehouses and work sites, each with the city and district the supplier reads, an
// address, and the receiver proposed for every delivery there. With Project Management
// a project's site joins the list by itself; its city is filled once here. Kept on the
// settings document (`deliverySites`), the owner's or the approver's to edit.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc, serverTimestamp, setDoc } from "firebase/firestore"
import { Loader2, MapPin, Plus } from "lucide-react"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { SAUDI_CITIES, displayCity } from "@/lib/constants"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"
import { siteLine, upsertSite, type DeliverySite } from "@/lib/procurement/delivery-sites"
import type { ProcReceiver } from "@/lib/procurement/receivers"

const newSiteId = () => `site_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function DeliverySitesPanel({
  orgId,
  stored,
  sites,
  receivers,
  mayEdit,
  openRequests,
}: {
  orgId: string
  /** What the settings document holds. */
  stored: DeliverySite[]
  /** Every site — the stored ones, the warehouses and the projects (`deliverySites`). */
  sites: DeliverySite[]
  receivers: ProcReceiver[]
  mayEdit: boolean
  /** Open incoming requests per site id. */
  openRequests: (siteId: string) => number
}) {
  const t = useTranslations("Portal.ProcSettings")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [editing, setEditing] = useState<DeliverySite | null>(null)
  const [saving, setSaving] = useState(false)
  const receiverName = useMemo(() => new Map(receivers.map((r) => [r.id, r.name])), [receivers])

  const save = async (site: DeliverySite) => {
    if (!firestore || !orgId) return
    setSaving(true)
    try {
      await setDoc(doc(firestore, PROCUREMENT_SETTINGS, orgId), { organizationId: orgId, deliverySites: upsertSite(stored, site), updatedAt: serverTimestamp() }, { merge: true })
      toast({ title: t("sites.saved") })
      setEditing(null)
    } catch {
      toast({ title: t("saveFailed"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("sites.sub")}</p>
        {mayEdit && (
          <Button size="sm" className="gap-1.5" onClick={() => setEditing({ id: newSiteId(), kind: "site", name: "", city: "", district: "", address: "", receiverId: null })}>
            <Plus size={14} /> {t("sites.add")}
          </Button>
        )}
      </div>
      {!sites.length ? (
        <EmptyState icon={MapPin} title={t("sites.none")} description={t("sites.none_hint")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">{t("sites.col_site")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("sites.col_city")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("sites.col_receiver")}</th>
                <th className="px-4 py-3 text-end font-semibold">{t("sites.col_open")}</th>
                <th className="px-4 py-3">
                  <span className="sr-only">{t("sites.edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sites.map((s) => (
                <tr key={s.id} className={s.retired ? "opacity-60" : undefined}>
                  <td className="px-4 py-3">
                    <b className="block" dir="auto">
                      {s.name}
                    </b>
                    <span className="text-xs text-muted-foreground">{t(`sites.kind_${s.kind}`)}</span>
                  </td>
                  <td className="px-4 py-3">{s.city ? siteLine(s, (c) => displayCity(c, locale)) : <StatusPill tone="warn">{t("sites.no_city")}</StatusPill>}</td>
                  <td className="px-4 py-3">{s.receiverId ? receiverName.get(s.receiverId) || "—" : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{openRequests(s.id)}</td>
                  <td className="px-4 py-3 text-end">
                    {mayEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                        {t("sites.edit")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.name ? editing.name : t("sites.add")}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              {editing.kind === "site" && (
                <div className="space-y-1">
                  <Label htmlFor="ds-name" className="text-xs">{t("sites.name")}</Label>
                  <Input id="ds-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} dir="auto" />
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="ds-city" className="text-xs">{t("sites.city")}</Label>
                  <NativeSelect id="ds-city" value={editing.city} onChange={(e) => setEditing({ ...editing, city: e.target.value })} className="w-full">
                    <option value="">{t("sites.pick_city")}</option>
                    {SAUDI_CITIES.map((c) => (
                      <option key={c} value={c}>
                        {displayCity(c, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="ds-district" className="text-xs">{t("sites.district")}</Label>
                  <Input id="ds-district" value={editing.district} onChange={(e) => setEditing({ ...editing, district: e.target.value })} dir="auto" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ds-address" className="text-xs">{t("sites.address")}</Label>
                <Input id="ds-address" value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} dir="auto" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ds-rcv" className="text-xs">{t("sites.receiver")}</Label>
                <NativeSelect id="ds-rcv" value={editing.receiverId || ""} onChange={(e) => setEditing({ ...editing, receiverId: e.target.value || null })} className="w-full">
                  <option value="">{t("sites.no_receiver")}</option>
                  {receivers
                    .filter((r) => r.active !== false)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} — {r.title}
                      </option>
                    ))}
                </NativeSelect>
                <p className="text-[11px] text-muted-foreground">{t("sites.receiver_hint")}</p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            {editing && stored.some((s) => s.id === editing.id) && editing.kind === "site" && (
              <Button variant="ghost" className="me-auto text-destructive" disabled={saving} onClick={() => void save({ ...editing, retired: !editing.retired })}>
                {editing.retired ? t("sites.restore") : t("sites.retire")}
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              {t("discard")}
            </Button>
            <Button onClick={() => editing && void save(editing)} disabled={saving || !editing?.name.trim() || !editing?.city} className="gap-1.5">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
