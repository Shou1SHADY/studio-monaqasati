// How money is displayed across the accounting screens: as reported, in
// thousands, or in millions. Presentation only — the ledger and every
// computation stay in exact riyals; scaling happens at the last moment, in the
// cell that prints the figure.

export type MoneyScale = "units" | "thousands" | "millions"

export const MONEY_SCALES: MoneyScale[] = ["units", "thousands", "millions"]

export function isMoneyScale(value: unknown): value is MoneyScale {
  return typeof value === "string" && (MONEY_SCALES as string[]).includes(value)
}

export function scaleDivisor(scale: MoneyScale): number {
  return scale === "millions" ? 1_000_000 : scale === "thousands" ? 1_000 : 1
}

/** Decimals worth printing at each scale: halalas as reported, one decimal in
 * thousands, two in millions — enough to tell 1.2M from 1.25M without noise. */
export function scaleDecimals(scale: MoneyScale): number {
  return scale === "millions" ? 2 : scale === "thousands" ? 1 : 2
}

export function formatMoney(value: number, scale: MoneyScale, opts: { decimals?: number } = {}): string {
  const decimals = opts.decimals ?? scaleDecimals(scale)
  const scaled = value / scaleDivisor(scale)
  // -0.0 after rounding would print as "-0.0"; a figure too small to show at
  // this scale is zero on the page.
  const rounded = Number(scaled.toFixed(decimals))
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** KPI tiles: whole numbers when reported, with a K / M suffix when scaled. */
export function formatMoneyCompact(value: number, scale: MoneyScale): string {
  if (scale === "units") return Math.round(value).toLocaleString("en-US")
  return `${formatMoney(value, scale)}${scale === "millions" ? "M" : "K"}`
}
