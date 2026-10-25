"use client"

// The supplier's file opened over whatever screen a `SupplierLink` sits on (SP-03). Loaded only when a link is pressed, so the screens
// that show supplier names do not carry the file's code (or its data hooks) until somebody asks for it.

import { useMemo, useState } from "react"
import { useRouter } from "@/i18n/routing"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { useProcurementPrices } from "@/hooks/useProcurementPrices"
import { useProcTeam } from "@/hooks/useProcTeam"
import { usePlatformCards, usePlatformSupplier } from "@/hooks/useSupplierDirectory"
import { supplierScore } from "@/lib/procurement/po"
import { canManageSuppliers, ordersOfSupplier, rfqInviteFacts } from "@/lib/procurement/supplier-file"
import type { GuestOfferFact } from "@/lib/procurement/supplier-offplatform"
import { DirectoryDrawer } from "./DirectoryDrawer"
import { SupplierFileDrawer } from "./SupplierFileDrawer"

/** The supplier's file, opened over whatever screen the link sits on. */
export default function SupplierFileHost({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const router = useRouter()
  const world = useProcurementWorld()
  const { orders, deliveries, rfqs, offers, actor, orgId: myOrg, supplierRecords } = world
  const team = useProcTeam(myOrg, actor)
  const { agreements } = useProcurementPrices(myOrg)
  const [now] = useState(() => new Date())
  const fetched = usePlatformSupplier(orgId, [])
  const cards = usePlatformCards(useMemo(() => [orgId], [orgId]))
  const record = supplierRecords.find((r) => r.supplierOrgId === orgId) || null
  const mine = useMemo(() => ordersOfSupplier(orders, orgId), [orders, orgId])
  if (!fetched) return null
  const supplier = { ...fetched, record, isMine: fetched.isMine || Boolean(record) || mine.length > 0 }
  const toSuppliers = (query: string) => router.push(`/contractor/suppliers?${query}`)

  if (!supplier.isMine) {
    return (
      <DirectoryDrawer
        supplier={supplier}
        open
        onOpenChange={(o) => !o && onClose()}
        actor={actor}
        orgId={myOrg}
        canManage={canManageSuppliers(actor, team.ownerHasTeam)}
        ownerHasTeam={team.ownerHasTeam}
        card={cards.get(orgId) || null}
        onOpenOurs={(id) => toSuppliers(`supplier=${encodeURIComponent(id)}`)}
      />
    )
  }
  const score = supplierScore(mine, deliveries, now, rfqInviteFacts(orgId, supplier.memberIds, rfqs, offers))
  return (
    <SupplierFileDrawer
      supplier={supplier}
      open
      onOpenChange={(o) => !o && onClose()}
      score={score}
      invited={rfqInviteFacts(orgId, supplier.memberIds, rfqs, offers).invited}
      orders={orders}
      agreements={agreements}
      actor={actor}
      orgId={myOrg}
      // Managing the file (favourite, remove, invite) stays on the Suppliers page; here it is read, as the prototype's stacked drawer is.
      canManage={false}
      ownerHasTeam={team.ownerHasTeam}
      now={now}
      notices={deliveries}
      card={cards.get(orgId) || null}
      offers={offers as unknown as GuestOfferFact[]}
      onToggleFavorite={() => undefined}
      onRemove={() => undefined}
      onOpenAgreement={(id) => toSuppliers(`segment=agreements&agreement=${encodeURIComponent(id)}`)}
    />
  )
}
