// HR 1.0 — trades and nationalities (PRD EM-03, HI-05, HI-08). A trade says
// whether the person is labour or staff, its reference wage (the offer band is
// 90–120% of it), whether it is reserved for Saudis (localized — a non-Saudi
// is blocked), and whether it drives (its licence then gates driving work,
// DC-06). Labels live in the message files (`Portal.HR.trade.<key>`). Pure.

export type TradeCategory = "labour" | "staff"

export interface Trade {
  key: string
  category: TradeCategory
  /** Reference monthly basic for the band (SAR). */
  ref: number
  /** Reserved for Saudis. */
  saudiOnly?: boolean
  /** The document that gates its driving work. */
  drives?: "licence" | "forklift"
}

export const TRADES: readonly Trade[] = [
  { key: "labourer", category: "labour", ref: 1500 },
  { key: "mason", category: "labour", ref: 2200 },
  { key: "carpenter", category: "labour", ref: 2300 },
  { key: "steelFixer", category: "labour", ref: 2300 },
  { key: "plumber", category: "labour", ref: 2400 },
  { key: "electrician", category: "labour", ref: 2500 },
  { key: "tiler", category: "labour", ref: 2400 },
  { key: "painter", category: "labour", ref: 2000 },
  { key: "plasterer", category: "labour", ref: 2100 },
  { key: "welder", category: "labour", ref: 2600 },
  { key: "stoneMason", category: "labour", ref: 2700 },
  { key: "operator", category: "labour", ref: 2800 },
  { key: "driver", category: "labour", ref: 2200, drives: "licence" },
  { key: "heavyDriver", category: "labour", ref: 2900, drives: "licence" },
  { key: "security", category: "labour", ref: 2000, saudiOnly: true },
  { key: "loader", category: "labour", ref: 1600 },
  { key: "forklift", category: "labour", ref: 2600, drives: "forklift" },
  { key: "mechanic", category: "labour", ref: 3200 },
  { key: "officeBoy", category: "labour", ref: 1800 },
  { key: "foreman", category: "staff", ref: 3800 },
  { key: "surveyor", category: "staff", ref: 4500 },
  { key: "safety", category: "staff", ref: 5500 },
  { key: "siteEngineer", category: "staff", ref: 9000 },
  { key: "quantitySurveyor", category: "staff", ref: 8500 },
  { key: "draughtsman", category: "staff", ref: 6500 },
  { key: "accountant", category: "staff", ref: 7500 },
  { key: "administrator", category: "staff", ref: 5000 },
  { key: "govRelations", category: "staff", ref: 6000, saudiOnly: true },
  { key: "hrOfficer", category: "staff", ref: 8000, saudiOnly: true },
  { key: "salesRep", category: "staff", ref: 7000 },
  { key: "manager", category: "staff", ref: 18000 },
  { key: "storekeeper", category: "staff", ref: 3500 },
  { key: "warehouseClerk", category: "staff", ref: 3000 },
  { key: "warehouseSupervisor", category: "staff", ref: 4500 },
  { key: "dispatcher", category: "staff", ref: 4000 },
  { key: "cashier", category: "staff", ref: 3800, saudiOnly: true },
  { key: "customerService", category: "staff", ref: 4500, saudiOnly: true },
  { key: "showroomManager", category: "staff", ref: 7000 },
  { key: "buyer", category: "staff", ref: 6500 },
  { key: "developmentManager", category: "staff", ref: 22000 },
  { key: "developmentEngineer", category: "staff", ref: 12000 },
  { key: "architect", category: "staff", ref: 11000 },
  { key: "civilEngineer", category: "staff", ref: 11000 },
  { key: "supervisionEngineer", category: "staff", ref: 10000 },
  { key: "marketing", category: "staff", ref: 8000 },
  { key: "legal", category: "staff", ref: 15000 },
  { key: "investment", category: "staff", ref: 13000 },
]

export const tradeOf = (key: string | null | undefined): Trade | null => TRADES.find((t) => t.key === key) ?? null

export const NATIONALITIES = ["sa", "eg", "in", "pk", "bd", "ye", "sd", "ph", "np", "sy", "jo", "lb"] as const
export type NationalityCode = (typeof NATIONALITIES)[number]

/** A Saudi under this basic does not count in Nitaqat (a warning, not a block). */
export const NITAQAT_MIN_BASIC = 4000
