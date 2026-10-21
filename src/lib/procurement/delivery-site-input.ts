// What a delivery site may be saved with (Procurement 2.0, SET-02 / ED-03): one schema for the settings page, the
// editor's «+ موقع جديد» and the route that writes them (`/api/procurement/delivery-sites`). Pure.

import { z } from "zod"

export const MAP_URL_MAX = 500

/**
 * A map link as typed («maps.app.goo.gl/…» is accepted) read as an https address, or null when it is not one. Only
 * https is kept: the supplier opens it, so no `javascript:`/`http:` link is ever stored.
 */
export function normaliseMapUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const value = raw.trim()
  if (!value || value.length > MAP_URL_MAX) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
  try {
    const url = new URL(withScheme)
    return url.protocol === "https:" && url.hostname.includes(".") ? url.toString() : null
  } catch {
    return null
  }
}

const mapUrl = z.preprocess(
  (v) => (typeof v === "string" && !v.trim() ? null : v),
  z
    .string()
    .max(MAP_URL_MAX)
    .transform((v, ctx) => {
      const url = normaliseMapUrl(v)
      if (!url) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "map_url" })
      return url as string
    })
    .nullable()
    .optional(),
)

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)

export const siteInputSchema = z
  .object({
    id: id.optional(),
    kind: z.enum(["site", "warehouse", "workshop", "project"]).default("site"),
    name: z.string().trim().min(1).max(120),
    city: z.string().trim().min(1).max(60),
    district: z.string().trim().max(80).default(""),
    address: z.string().trim().max(300).default(""),
    receiverId: z.string().trim().max(128).nullable().optional(),
    projectId: z.string().trim().max(128).nullable().optional(),
    warehouseId: z.string().trim().max(128).nullable().optional(),
    mapUrl,
    retired: z.boolean().optional(),
  })
  .strict()

export type SiteInput = z.infer<typeof siteInputSchema>
