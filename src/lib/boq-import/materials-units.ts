import { digits } from './reader';
import { UNIT_KIND_GROUPS, UNIT_SYNONYMS } from './materials-lexicon';
import { norm, unitNorm } from './materials-text';
import type { MaterialUnit } from '@/lib/materials/types';

export interface UnitKind {
  kind: string;
  factor: number;
}

const KINDS: ReadonlyMap<string, UnitKind> = new Map(UNIT_KIND_GROUPS.flatMap(([kind, factor, ...words]) => words.map(w => [unitNorm(w), { kind, factor }] as const)));

/** What a unit of the file is, and how many of its kind's base it makes: kg → mass ×1, t → mass ×1000. */
export const unitKindOf = (raw: unknown): UnitKind | null => KINDS.get(unitNorm(raw)) || null;

/** The kinds a fixed arithmetic can convert inside. A count (pieces, bags) is never converted into another count. */
export const MEASURES: readonly string[] = ['len', 'area', 'vol', 'mass'];

const synonym = (key: string): string => (Object.prototype.hasOwnProperty.call(UNIT_SYNONYMS, key) ? (UNIT_SYNONYMS as Readonly<Record<string, string>>)[key] : key);

/** The place of the file's unit among the material's units, or -1. Compared as words, with the file's spellings («م3», «شكارة»). */
export function unitIndex(units: readonly MaterialUnit[], raw: string): number {
  if (!raw) return -1;
  const r = norm(synonym(unitNorm(raw)));
  return units.findIndex(u => norm(u.ar) === r || norm(u.en || '') === r);
}

export interface UnitReading {
  /** The material's unit the row takes (index in the material's units). */
  u: number;
  /** The file's quantity and unit when the number was converted inside one kind: «6800 كجم». */
  conv: { q: string; u: string } | null;
  /** The file's unit is of another kind than the material's: the number is not carried over and the user is asked. */
  ask: boolean;
  /** The unit is not one the material has and could not be converted: it waits for a button. */
  unknown: boolean;
  /** The quantity the row takes (empty when asked). */
  qty: string;
}

export interface UnitInput {
  units: readonly MaterialUnit[];
  unitRaw: string;
  /** The file's quantity as written. */
  fileQty: string;
  /** The user has typed the quantity: it stands. */
  edited: boolean;
  /** The user confirmed the unit: it stands. */
  confirmed: boolean;
  qty: string;
}

/**
 * The unit always comes from the material's list. The file's unit is kept when it is one of them; converted
 * (6800 كجم → 6.8 طن) when it is of the same measuring kind; and when it is of another kind (metres for a
 * material ordered by the piece) the number is NOT carried over — the row asks «كم حبة؟».
 */
export function readUnit(i: UnitInput): UnitReading {
  const base: UnitReading = { u: 0, conv: null, ask: false, unknown: false, qty: i.edited ? i.qty : i.fileQty };
  if (!i.unitRaw) return base;
  const k = unitIndex(i.units, i.unitRaw);
  if (k >= 0) return { ...base, u: k };
  if (i.confirmed) return base;
  const a = unitKindOf(i.unitRaw);
  const kk = a && MEASURES.includes(a.kind) ? i.units.findIndex(u => unitKindOf(u.ar)?.kind === a.kind) : -1;
  if (kk >= 0 && a) {
    const b = unitKindOf(i.units[kk].ar) as UnitKind;
    if (!i.edited && Number(i.fileQty) > 0 && a.factor !== b.factor)
      return { ...base, u: kk, qty: String(Number(((Number(i.fileQty) * a.factor) / b.factor).toFixed(4))), conv: { q: i.fileQty, u: i.unitRaw } };
    return { ...base, u: kk };
  }
  if (a && !i.edited) return { ...base, ask: true, unknown: true, qty: '' };
  return { ...base, unknown: true };
}

export const fileNumber = (v: unknown): string => digits(v).replace(/[,٬]/g, '').replace(/٫/g, '.').replace(/[^\d.]/g, '');
