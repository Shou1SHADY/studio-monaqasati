"use client"

// The receiver register, kept in Procurement settings (PRD 3.0 §4 `RCVR`).
//
// Short by nature: the people who sign for goods, and where. The list answers
// two questions at a glance — who receives at which place, and which of these
// numbers a code can actually reach — so the mobile is shown, not hidden behind
// a row click.
//
// A receiver is retired, never deleted, because a delivery forwarded to them
// names them. Retired rows drop to the bottom and out of every forward list.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Plus, UserPlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useFirestore } from "@/firebase"
import { addReceiver, setReceiverActive, updateReceiver } from "@/lib/procurement/receiver-writes"
import { RECEIVER_MODULES, phoneUsable, receiverProblems, receiverRows, type ProcReceiver, type ReceiverInput, type ReceiverModule } from "@/lib/procurement/receivers"
import { ProcWriteError } from "@/lib/procurement/writes"
import type { ProcActor } from "@/lib/procurement/types"

const blank = (): ReceiverInput => ({ name: "", title: "", module: "inventory", phone: "", userId: null, warehouseIds: [] })

export function ReceiverRegister({
  receivers,
  warehouses,
  actor,
  orgId,
  mayEdit,
}: {
  receivers: ProcReceiver[]
  warehouses: Array<{ id: string; name: string }>
  actor: ProcActor
  orgId: string
  mayEdit: boolean
}) {
  const t = useTranslations("Portal.ProcReceivers")
  const firestore = useFirestore()
  const [editing, setEditing] = useState<ProcReceiver | null | undefined>(undefined)
  const [form, setForm] = useState<ReceiverInput>(blank())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows = useMemo(() => receiverRows(receivers), [receivers])
  const nameOf = (id: string) => warehouses.find((w) => w.id === id)?.name || id
  const problems = receiverProblems(form)

  const open = (r: ProcReceiver | null) => {
    setEditing(r)
    setForm(r ? { name: r.name, title: r.title, module: r.module, phone: r.phone, userId: r.userId || null, warehouseIds: r.warehouseIds || [] } : blank())
    setError(null)
  }

  const submit = async () => {
    if (!firestore || problems.length) return
    setBusy(true)
    setError(null)
    try {
      if (editing) await updateReceiver(firestore, actor, editing.id, form)
      else await addReceiver(firestore, actor, orgId, form)
      setEditing(undefined)
    } catch (err) {
      setError(err instanceof ProcWriteError ? t(`err.${err.code}`) : t("err.generic"))
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (r: ProcReceiver) => {
    if (!firestore) return
    try {
      await setReceiverActive(firestore, actor, r.id, r.active === false)
    } catch {
      /* the list re-renders from the store either way */
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">{t("intro")}</p>
        {mayEdit && (
          <Button size="sm" variant="outline" onClick={() => open(null)}>
            <Plus size={14} className="me-1.5" />
            {t("add")}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="border-t px-4 py-10 text-center text-muted-foreground">
          <UserPlus size={32} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm font-bold">{t("emptyTitle")}</p>
          <p className="mt-1 text-[11px]">{t("emptyDesc")}</p>
        </div>
      ) : (
        <ul className="divide-y border-t">
          {rows.map((r) => (
            <li key={r.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3", r.active === false && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold" dir="auto">
                  {r.name}
                  {r.active === false && (
                    <Badge variant="outline" className="ms-2 border-border bg-muted text-[10px] font-bold text-muted-foreground">
                      {t("retired")}
                    </Badge>
                  )}
                </p>
                <p className="truncate text-[11px] text-muted-foreground" dir="auto">
                  {r.title}
                  {" · "}
                  {t(`module.${r.module}`)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {(r.warehouseIds || []).length ? (r.warehouseIds || []).map(nameOf).join(" · ") : t("anyPlace")}
                </p>
              </div>
              <span className={cn("text-xs tabular-nums", phoneUsable(r.phone) ? "text-foreground" : "text-destructive")} dir="ltr">
                {r.phone || "—"}
              </span>
              {mayEdit && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => open(r)}>
                    {t("edit")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(r)}>
                    {r.active === false ? t("restore") : t("retire")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? t("dialog.editTitle") : t("dialog.addTitle")}</DialogTitle>
            <DialogDescription>{t("dialog.desc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rcv-name">{t("dialog.name")}</Label>
              <Input id="rcv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rcv-title">{t("dialog.title")}</Label>
              <Input id="rcv-title" placeholder={t("dialog.titlePlaceholder")} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rcv-phone">{t("dialog.phone")}</Label>
                <Input id="rcv-phone" inputMode="tel" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rcv-module">{t("dialog.module")}</Label>
                <select
                  id="rcv-module"
                  value={form.module}
                  onChange={(e) => setForm({ ...form, module: e.target.value as ReceiverModule })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {RECEIVER_MODULES.map((m) => (
                    <option key={m} value={m}>
                      {t(`module.${m}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t("dialog.places")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {warehouses.map((w) => {
                  const on = form.warehouseIds.includes(w.id)
                  return (
                    <button
                      key={w.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setForm({ ...form, warehouseIds: on ? form.warehouseIds.filter((id) => id !== w.id) : [...form.warehouseIds, w.id] })}
                      className={cn(
                        "min-h-9 rounded-full border px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "border-module bg-module/10 text-module" : "border-border text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {w.name}
                      {on && <X size={11} className="ms-1 inline" aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">{form.warehouseIds.length ? t("dialog.placesPicked") : t("dialog.placesNone")}</p>
            </div>

            {error && <p className="text-sm font-bold text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(undefined)} disabled={busy}>
              {t("dialog.cancel")}
            </Button>
            <Button onClick={submit} disabled={problems.length > 0 || busy}>
              {busy && <Loader2 className="me-1.5 animate-spin" size={14} />}
              {t("dialog.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
