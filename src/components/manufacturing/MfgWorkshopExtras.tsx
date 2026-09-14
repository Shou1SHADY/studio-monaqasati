"use client"

// Bridge between the legacy workshop view and the v2 (product-born) model: a
// self-contained v2 order dialog the legacy table (and the project page's
// embedded workshop) can open. New orders start in MfgNewOrderWizard.

import { usePermissions } from "@/hooks/usePermissions"
import { useMfgData } from "@/hooks/useMfgData"
import { MfgOrderV2Dialog } from "./MfgOrderV2Dialog"

/** Opens the rich v2 dialog for a work order id — loads its own data so the
 * legacy view only needs the id. */
export function MfgOrderV2DialogStandalone({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const data = useMfgData()
  const { can } = usePermissions()
  const order = data.v2Orders.find((o) => o.id === orderId) || null
  if (!order) return null
  return (
    <MfgOrderV2Dialog
      order={order}
      product={data.productById.get(order.productId || "") || null}
      departments={data.departments}
      settings={data.settings}
      notes={data.notesByOrder.get(order.id) || []}
      schedule={data.schedule.get(order.id) || null}
      warehouses={data.warehouses}
      actor={data.actor}
      orgId={data.orgId}
      canManage={data.canManage}
      canWork={data.canWork}
      canQc={data.canQc}
      canCost={data.canCost}
      seesMoney={data.seesMoney}
      canReceive={can("warehouses.receive") || can("warehouses.manage")}
      onClose={onClose}
    />
  )
}
