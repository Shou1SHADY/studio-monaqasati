import type { PortalScope } from "@/i18n/message-scope"

export const LANDING_PROJECT_TYPE_KEYS = ["proj_type_infrastructure", "proj_type_buildings", "proj_type_roads", "proj_type_industrial", "proj_type_energy", "proj_type_other"] as const

export const ROUTE_PORTAL_SCOPES = {
  landing: { Contractor: LANDING_PROJECT_TYPE_KEYS },
  supplierSignup: { Home: true, Sidebar: true, Shared: true },
  offer: { Shared: true },
  po: { ProcChats: true },
  receive: { ProcReceipts: true, Procurement: true },
} as const satisfies Record<string, PortalScope>
