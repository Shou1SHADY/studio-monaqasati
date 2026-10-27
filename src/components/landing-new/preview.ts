/** The slice of `/api/landing/preview` the new landing reads (the API sends more). */
export type LandingPreviewSupplier = { id: string; initial: string; category: string; bg: string };
export type LandingPreview = {
  rfq: { offersCount: number } | null;
  suppliers: LandingPreviewSupplier[];
  supplierCount: number;
};

export function isLandingPreview(v: unknown): v is LandingPreview {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.suppliers) && typeof o.supplierCount === 'number';
}

/** Shown while the live numbers load, or when the API has none (a fresh environment). */
export const FALLBACK_OFFERS = 3;
