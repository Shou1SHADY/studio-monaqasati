"use client"

// Supply › Direct purchases on a PM 1.0 project (prototype pettyPanel · formCASH):
// site cash under an approved cap — per purchase and per rolling 30 days — with a
// receipt. Above the cap it is a normal material request. Each purchase reaches
// Finance as a project cost (prj:CASH).

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Loader2, Plus, ShoppingBag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { PETTY_CAP, pettyBlocks, pettyMonth, PM_PETTY, type PmPetty } from "@/lib/pm/supply"
import { logDirectPurchase, type SupplyActor } from "@/lib/pm/supply-writes"
import { cn } from "@/lib/utils"
import { FormHint } from "./ContractBits"
import { useLocaleDir, useSupplyRun } from "./SupplyDialogs"

const n0 = (n: number) => Math.round(n).toLocaleString("en-US")

export function DirectPurchasesPanel({ projectId, access, actor }: { projectId: string; access: PmAccess; actor: SupplyActor }) {
  const t = useTranslations("Portal.PM")
  const { locale } = useLocaleDir()
  const firestore = useFirestore()
  const [open, setOpen] = useState(false)
  const q = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_PETTY) : null), [firestore, projectId])
  const { data } = useCollection(q)
  const list = useMemo(() => ((data ?? []) as unknown as PmPetty[]).slice().sort((a, b) => b.day.localeCompare(a.day) || b.seq - a.seq), [data])
  const today = todayDay()
  const month = pettyMonth(list, today)
  const left = Math.max(0, PETTY_CAP.month - month)
  const money = access.has("money")
  const canLog = !access.ctx.archived && access.allowed("supply.request")

  return (
    <>
      <Panel
        title={t("petty.title")}
        icon={ShoppingBag}
        actions={
          canLog ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus size={15} className="me-1.5" aria-hidden="true" />
              {t("petty.add")}
            </Button>
          ) : null
        }
        bodyClassName="p-0"
      >
        <p className="px-4 pt-3 text-xs text-muted-foreground">{t("petty.caps", { one: n0(PETTY_CAP.one), month: n0(PETTY_CAP.month) })}</p>
        <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-3">
          <div className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">{t("petty.spent")}</p>
            <p className={cn("text-lg font-black tabular-nums", month > PETTY_CAP.month * 0.8 && "text-destructive")} dir="ltr">
              {pmMoney(month)}
            </p>
            <p className="text-xs text-muted-foreground">{t("petty.of", { cap: n0(PETTY_CAP.month) })}</p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">{t("petty.left")}</p>
            <p className="text-lg font-black tabular-nums" dir="ltr">
              {pmMoney(left)}
            </p>
            <p className="text-xs text-muted-foreground">{left <= 0 ? t("petty.exhausted") : t("petty.after")}</p>
          </div>
          <div className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">{t("petty.count")}</p>
            <p className="text-lg font-black tabular-nums">{list.length}</p>
            <p className="text-xs text-muted-foreground">{t("petty.count_sub")}</p>
          </div>
        </div>
        {list.length === 0 ? (
          <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">{t("petty.empty")}</p>
        ) : (
          <div className="divide-y border-t">
            {list.map((x) => (
              <div key={x.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold" dir="auto">
                    {x.what}
                  </p>
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {x.supplier} · {pmDate(x.day, locale)} · {x.byName || "—"} · {x.receipt ? t("petty.receipt", { no: x.receipt }) : <span className="text-warning">{t("petty.no_receipt")}</span>}
                  </p>
                </div>
                {money && (
                  <b className="shrink-0 tabular-nums" dir="ltr">
                    {pmMoney(x.amount)}
                  </b>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t("petty.foot")}</p>
      </Panel>
      {open && <PettyDialog projectId={projectId} access={access} actor={actor} month={month} onClose={() => setOpen(false)} />}
    </>
  )
}

function PettyDialog({ projectId, access, actor, month, onClose }: { projectId: string; access: PmAccess; actor: SupplyActor; month: number; onClose: () => void }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const today = todayDay()
  const [what, setWhat] = useState("")
  const [supplier, setSupplier] = useState("")
  const [amount, setAmount] = useState("")
  const [receipt, setReceipt] = useState("")
  const [day, setDay] = useState(today)
  const amt = Number(amount) || 0
  const blocks = pettyBlocks({ archived: access.ctx.archived, what, supplier, amount: amt, day, today })
  const overOne = amt > PETTY_CAP.one
  const overMonth = !overOne && month + amt > PETTY_CAP.month

  const save = async () => {
    if (!firestore) return
    const done = await run("petty", () => logDirectPurchase(firestore, access.ctx, projectId, actor, { what, supplier, amount: amt, receipt, day }), t("petty.logged", { amount: n0(amt) }))
    if (done) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("petty.form.title")}</DialogTitle>
          <DialogDescription>{t("petty.form.desc", { one: n0(PETTY_CAP.one), month: n0(PETTY_CAP.month) })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pt-what">{t("petty.form.what")} *</Label>
            <Input id="pt-what" dir="auto" placeholder={t("petty.form.what_ph")} value={what} onChange={(e) => setWhat(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pt-sup">{t("petty.form.from")} *</Label>
              <Input id="pt-sup" dir="auto" placeholder={t("petty.form.from_ph")} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pt-amt">{t("petty.form.amount")} *</Label>
              <Input id="pt-amt" type="number" min={0} dir="ltr" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {overOne && <FormHint tone="bad">{t("petty.form.over_one", { one: n0(PETTY_CAP.one) })}</FormHint>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pt-rc">{t("petty.form.receipt")}</Label>
              <Input id="pt-rc" dir="auto" placeholder={t("petty.form.receipt_ph")} value={receipt} onChange={(e) => setReceipt(e.target.value)} />
              {!receipt.trim() && <FormHint>{t("petty.form.receipt_hint")}</FormHint>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pt-day">{t("petty.form.date")}</Label>
              <Input id="pt-day" type="date" dir="ltr" max={today} value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
          </div>
          {overMonth && <Callout tone="warn">{t("petty.form.over_month", { spent: n0(month), month: n0(PETTY_CAP.month) })}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            {t("sup.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={blocks.length > 0 || busy !== null}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("petty.form.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
