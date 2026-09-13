// Chart colors for the Finance & Accounting screens.
//
// SVG marks cannot take Tailwind classes, so the series colors live here, once.
// Slot 1 is the brand's CTA blue; slots 2–3 complete a categorical set that was
// run through the data-viz palette validator against the white card surface:
// lightness band, chroma floor, CVD separation (worst adjacent ΔE 9.2) and the
// normal-vision floor all pass. Slot 3 sits below 3:1 contrast on white, so
// every chart using it also shows its values as text (legend + labels/table).
//
// Assign in this order and by entity, never by rank — revenue is always slot 1.

export const CHART_SERIES = {
  1: "#0369A1",
  2: "#eb6834",
  3: "#1baf7a",
} as const

/** Axis ticks, gridlines and the baseline — recessive hairlines. */
export const CHART_INK = {
  axis: "#64748b",
  grid: "#E2E8F0",
  baseline: "#cbd5e1",
} as const
