"use client"

// Suppliers who asked to connect with this company (Supplier 1.0, CON-03): each waits as a link in "pending" until
// a buyer or the manager answers it. Accepting puts the supplier in the list; either answer tells him.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Check, X } from "lucide-react"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { ProcWriteError } from "@/lib/procurement/writes"
import { answerConnectionRequest, type ConnectionRequest } from "@/lib/procurement/supplier-acts-writes"
import type { ProcActor } from "@/lib/procurement/types"

interface LinkDoc extends ConnectionRequest {
  status?: string
  requestedBy?: string
  requestNote?: string
  supplierCategories?: string[]
}

export function SupplierConnectionRequests({ orgId, orgName, actor, canManage }: { orgId: string; orgName: string; actor: ProcActor; canManage: boolean }) {
  const t = useTranslations("Portal.ProcSuppliers")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale() as "ar" | "en"
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "contractorSupplierLinks"), where("contractorOrgId", "==", orgId), where("status", "==", "pending")) : null), [firestore, orgId])
  const { data } = useCollection<Omit<LinkDoc, "id">>(q)
  const requests = ((data || []) as LinkDoc[]).filter((l) => l.requestedBy === "supplier")
  if (!canManage || !requests.length) return null

  const answer = async (r: LinkDoc, accept: boolean) => {
    if (!firestore) return
    setBusy(r.id)
    try {
      await answerConnectionRequest(firestore, actor, canManage, orgId, r, accept, { copy: tShared, locale, orgName })
      toast({ title: t(accept ? "req.accepted" : "req.declined", { supplier: r.supplierName }) })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof ProcWriteError ? "req.no_permission" : "req.failed"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-500/5" aria-label={t("req.title")}>
      <header className="border-b border-amber-500/20 px-3 py-2">
        <h3 className="text-xs font-black text-amber-700 dark:text-amber-400">{t("req.title", { count: requests.length })}</h3>
      </header>
      <ul className="divide-y">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-bold" dir="auto">
                {r.supplierName}
              </p>
              {(r.supplierCategories || []).length > 0 && (
                <p className="text-[11px] text-muted-foreground" dir="auto">
                  {(r.supplierCategories || []).join(" · ")}
                </p>
              )}
              {r.requestNote && (
                <p className="mt-0.5 text-xs text-foreground/80" dir="auto">
                  {r.requestNote}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="success" className="gap-1.5" disabled={busy === r.id} onClick={() => void answer(r, true)}>
                <Check size={14} aria-hidden="true" />
                {t("req.accept")}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={busy === r.id} onClick={() => void answer(r, false)}>
                <X size={14} aria-hidden="true" />
                {t("req.decline")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
