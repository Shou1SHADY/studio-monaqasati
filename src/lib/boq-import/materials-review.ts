import { evaluateUnit, isReady, isRow, needsYou } from './materials-read';
import type { ImportRow } from './materials-read';
import type { MaterialMatch, MaterialMemoryEntry, Matcher, SpecChoice } from './materials-match';
import { fileNumber } from './materials-units';

/** The user's choice of a material for a row: one of the list (with the values he chose), or «not in the list» under a sub-category. */
export type MaterialChoice = { outside: false; nodeId: string; specs: SpecChoice[]; brand: number | null } | { outside: true; sub: string };

export interface ReviewCounts {
  /** Lines read as material lines (not works, deductions or removed). */
  items: number;
  ready: number;
  needYou: number;
  /** Lines like no material: shown folded, added only if the user asks. */
  notMaterials: number;
  /** Rows that will be added. */
  toAdd: number;
}

export function counts(rows: readonly ImportRow[]): ReviewCounts {
  const items = rows.filter(r => r.kind === 'row' && !r.removed);
  return {
    items: items.length,
    ready: rows.filter(r => isRow(r) && isReady(r)).length,
    needYou: rows.filter(needsYou).length,
    notMaterials: items.filter(r => !r.inc).length,
    toAdd: rows.filter(isRow).length,
  };
}

export interface ReviewGroups {
  need: number[];
  ready: number[];
  none: number[];
}

/** The rows by place, in the review's two groups (needs you, then ready) and the folded «not in the materials list». */
export function groupsOf(rows: readonly ImportRow[]): ReviewGroups {
  const at = (f: (r: ImportRow) => boolean): number[] => rows.flatMap((r, i) => (f(r) ? [i] : []));
  return {
    need: at(needsYou),
    ready: at(r => isRow(r) && isReady(r)),
    none: at(r => r.kind === 'row' && !r.inc && !r.removed),
  };
}

const patch = (rows: readonly ImportRow[], at: number, f: (r: ImportRow) => ImportRow): ImportRow[] => rows.map((r, i) => (i === at ? f(r) : r));

/** The quantity typed by the user stands from now on; typing a number also settles the unit question («كم حبة؟»). */
export function typeQuantity(rows: readonly ImportRow[], at: number, value: string): ImportRow[] {
  return patch(rows, at, r => {
    const qty = fileNumber(value);
    return { ...r, qty, qEdit: true, conv: null, why: r.why.filter(w => w !== 'noqty' && w !== 'unit'), unitOk: Number(qty) > 0 ? true : r.unitOk };
  });
}

export const chooseUnit = (rows: readonly ImportRow[], at: number, u: number): ImportRow[] => patch(rows, at, r => ({ ...r, u, unitOk: true, why: r.why.filter(w => w !== 'unit') }));

export const confirmUnit = (rows: readonly ImportRow[], at: number): ImportRow[] => patch(rows, at, r => ({ ...r, unitOk: true, why: r.why.filter(w => w !== 'unit') }));

export const removeRow = (rows: readonly ImportRow[], at: number): ImportRow[] => patch(rows, at, r => ({ ...r, inc: false, removed: true }));

/** «أرجعه»: a work line, a deduction or a removed row comes back as a material line, matched again. */
export function bringBack(rows: readonly ImportRow[], at: number, matcher: Matcher, memory: ReadonlyMap<string, MaterialMemoryEntry> | null): ImportRow[] {
  return patch(rows, at, r => {
    if (r.kind === 'row') return { ...r, removed: false, inc: true };
    const m: MaterialMatch = matcher.match(r.name, r.ctx, memory);
    const back: ImportRow = { ...r, kind: 'row', removed: false, nodeId: m.nodeId, specs: m.specs, free: m.free, brand: m.brand, how: m.how, suggestions: m.suggestions, why: r.qty ? [] : ['noqty'] };
    return { ...evaluateUnit(back, matcher), inc: true };
  });
}

/** The user picked the material (from the closest three, the search, or «not in the list»). */
export function chooseMaterial(rows: readonly ImportRow[], at: number, choice: MaterialChoice, matcher: Matcher): ImportRow[] {
  return patch(rows, at, r => {
    const open: ImportRow = { ...r, inc: true, removed: false, unitOk: false, kind: 'row', how: 'user' };
    if (choice.outside) return { ...open, nodeId: null, outside: true, sub: choice.sub, specs: [], free: [], brand: null, why: open.why.filter(w => w !== 'unit'), u: 0, conv: null, ask: false };
    return evaluateUnit({ ...open, nodeId: choice.nodeId, outside: false, sub: null, specs: choice.specs, free: [], brand: choice.brand }, matcher);
  });
}

/** What a company remembers of this pick: the file's text → the material, by names so a changed list does not break it. */
export function memoryOf(matcher: Matcher, text: string, choice: Extract<MaterialChoice, { outside: false }>): MaterialMemoryEntry {
  const specs = matcher.specsOf(choice.nodeId);
  return {
    text,
    nodeId: choice.nodeId,
    specs: choice.specs.map(s => ({ spec: specs[s.spec].ar, option: specs[s.spec].options[s.option].ar })),
    brand: choice.brand == null ? null : matcher.brandsOf(choice.nodeId)[choice.brand].ar,
  };
}
