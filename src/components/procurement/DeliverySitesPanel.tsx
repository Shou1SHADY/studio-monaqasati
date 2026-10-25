"use client"

// Settings → «مواقع التسليم» (Procurement 1.5, PUR-10): where goods go, in every package —
// warehouses and work sites, each with the city and district the supplier reads, an
// address, and the receiver proposed for every delivery there. With Project Management
// a project's site joins the list by itself; its city is filled once here. Kept on the
// settings document (`deliverySites`) and written by `/api/procurement/delivery-sites`, the
// owner's or the approver's to edit. A site may carry a map link the supplier opens (SET-02).

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ExternalLink, Loader2, MapPin, Plus } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { SAUDI_CITIES, displayCity } from "@/lib/constants"
import { normaliseMapUrl } from "@/lib/procurement/delivery-site-input"
import { linkedProjectId, manualSite, siteLine, type DeliverySite, type DeliverySiteKind } from "@/lib/procurement/delivery-sites"
import type { ProcReceiver } from "@/lib/procurement/receivers"
import { saveDeliverySite } from "@/components/procurement/location/saveDeliverySite"

const newSiteId = () => `site_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function DeliverySitesPanel({
  stored,
  sites,
  receivers,
  mayEdit,
  openRequests,
  pmOn = false,
  mfgOn = false,
  projects = [],
  members,
}: {
  /** What the settings document holds. */
  stored: DeliverySite[]
  /** Every site — the stored ones, the warehouses and the projects (`deliverySites`). */
  sites: DeliverySite[]
  receivers: ProcReceiver[]
  mayEdit: boolean
  /** Open incoming requests per site id. */
  openRequests: (siteId: string) => number
  /** Project Management is in the package: a work site can be linked to a project. */
  pmOn?: boolean
  /** Manufacturing is in the package: the workshop's warehouse is a kind of place. */
  mfgOn?: boolean
  projects?: Array<{ id: string; name?: string }>
  /** Without Projects: the company's members, to name a site's manager — he approves the team's requests for it when the policy is on. */
  members?: Array<{ id: string; name: string }>
}) {
  const t = useTranslations("Portal.ProcSettings")
  const locale = useLocale()
  const { toast } = useToast()
  const [editing, setEditing] = useState<DeliverySite | null>(null)
  const [mapText, setMapText] = useState("")
  const [mapBad, setMapBad] = useState(false)
  const [saving, setSaving] = useState(false)
  const receiverName = useMemo(() => new Map(receivers.map((r) => [r.id, r.name])), [receivers])
  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.name || p.id])), [projects])

  const open = (site: DeliverySite | null) => {
    setEditing(site)
    setMapText(site?.mapUrl || "")
    setMapBad(false)
  }

  const save = async (site: DeliverySite) => {
    if (mapText.trim() && !normaliseMapUrl(mapText)) {
      setMapBad(true)
      return
    }
    setSaving(true)
    const result = await saveDeliverySite({
      id: site.id,
      kind: site.kind,
      name: site.name,
      city: site.city,
      district: site.district,
      address: site.address,
      receiverId: site.receiverId,
      ...(members ? { managerId: site.managerId || null } : {}),
      projectId: site.projectId || null,
      warehouseId: site.warehouseId || null,
      mapUrl: mapText.trim() ? normaliseMapUrl(mapText) : null,
      ...(site.retired ? { retired: true } : {}),
    })
    setSaving(false)
    if ("error" in result) {
      if (result.error === "BAD_MAP_URL") setMapBad(true)
      else toast({ title: t(result.error === "FORBIDDEN" ? "sites.err_forbidden" : "saveFailed"), variant: "destructive" })
      return
    }
    toast({ title: t("sites.saved") })
    setEditing(null)
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("sites.sub")}</p>
        {mayEdit && (
          <Button size="sm" className="gap-1.5" onClick={() => open({ id: newSiteId(), kind: "site", name: "", city: "", district: "", address: "", receiverId: null })}>
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
                    <span className="text-xs text-muted-foreground">
                      {s.kind === "warehouse" ? t(s.warehouseId ? "sites.line_warehouse_inv" : "sites.line_warehouse") : s.kind === "workshop" ? t("sites.line_workshop") : t(`sites.kind_${s.kind}`)}
                      {pmOn && linkedProjectId(s) && <> · {t("sites.linked_to", { project: projectName.get(linkedProjectId(s) as string) || "—" })}</>}
                      {s.mapUrl && (
                        <>
                          {" · "}
                          <a href={s.mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-module hover:underline">
                            {t("sites.map_open")}
                            <ExternalLink size={11} aria-hidden="true" />
                          </a>
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">{s.city ? siteLine(s, (c) => displayCity(c, locale)) : <StatusPill tone="warn">{t("sites.no_city")}</StatusPill>}</td>
                  <td className="px-4 py-3">{s.receiverId ? receiverName.get(s.receiverId) || "—" : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{openRequests(s.id)}</td>
                  <td className="px-4 py-3 text-end">
                    {mayEdit && (
                      <Button size="sm" variant="ghost" onClick={() => open(s)}>
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
              {manualSite(editing) && (
                <div className="space-y-1">
                  <Label htmlFor="ds-name" className="text-xs">{t("sites.name")}</Label>
                  <Input id="ds-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} dir="auto" />
                </div>
              )}
              {manualSite(editing) && !stored.some((s) => s.id === editing.id) && (
                <div className="space-y-1">
                  <Label htmlFor="ds-kind" className="text-xs">{t("sites.kind")}</Label>
                  <NativeSelect id="ds-kind" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as DeliverySiteKind })} className="w-full">
                    {(mfgOn ? (["site", "warehouse", "workshop"] as const) : (["site", "warehouse"] as const)).map((k) => (
                      <option key={k} value={k}>
                        {t(`sites.kind_${k}`)}
                      </option>
                    ))}
                  </NativeSelect>
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
                <Label htmlFor="ds-map" className="text-xs">
                  {t("sites.map_url")} <span className="font-normal text-muted-foreground">{t("sites.optional")}</span>
                </Label>
                <Input
                  id="ds-map"
                  value={mapText}
                  onChange={(e) => {
                    setMapText(e.target.value)
                    setMapBad(false)
                  }}
                  placeholder="maps.app.goo.gl/…"
                  dir="ltr"
                  aria-invalid={mapBad || undefined}
                />
                {mapBad && (
                  <p className="text-[11px] font-semibold text-destructive" role="alert">
                    {t("sites.err_map")}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">{t("sites.map_hint")}</p>
              </div>
              {pmOn && editing.kind === "site" && (
                <div className="space-y-1">
                  <Label htmlFor="ds-project" className="text-xs">{t("sites.project")}</Label>
                  <NativeSelect id="ds-project" value={editing.projectId || ""} onChange={(e) => setEditing({ ...editing, projectId: e.target.value || null })} className="w-full">
                    <option value="">{t("sites.no_project")}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="text-[11px] text-muted-foreground">{t("sites.project_hint")}</p>
                </div>
              )}
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
              {members && (
                <div className="space-y-1">
                  <Label htmlFor="ds-mgr" className="text-xs">{t("sites.manager")}</Label>
                  <NativeSelect id="ds-mgr" value={editing.managerId || ""} onChange={(e) => setEditing({ ...editing, managerId: e.target.value || null })} className="w-full">
                    <option value="">{t("sites.no_manager")}</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="text-[11px] text-muted-foreground">{t("sites.manager_hint")}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {editing && stored.some((s) => s.id === editing.id) && manualSite(editing) && (
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
