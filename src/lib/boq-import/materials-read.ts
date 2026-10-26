import { isLump, understand } from './reader';
import type { Book, Grid, IgnoredRow, ReadItem, ReadResult, ReadRow, ReadSheetInfo, UnderstandOptions } from './reader';
import { BoqLoadError, loadBook } from './load';
import type { LoadError } from './load';
import { coreText, norm, stripMark } from './materials-text';
import type { MaterialMatch, MaterialMemory, Matcher, MatchHow, SpecChoice } from './materials-match';
import { readUnit } from './materials-units';
import { unitsOf } from '@/lib/materials/tree';

export const MATERIALS_MAX_ROWS = 500;
export const MATERIALS_MAX_MB = 5;

export type ImportError = LoadError | 'rows' | 'noitems' | 'unfilled';

export class MaterialsFileError extends Error {
  readonly code: ImportError;

  constructor(code: ImportError) {
    super(code);
    this.code = code;
  }
}

export type RowKind = 'row' | 'lump' | 'neg';
export type RowWhy = 'noqty' | 'unit';

/** One line of the file as the review shows it: the text, the material it was matched to (or not), the quantity and unit. */
export interface ImportRow {
  row: number;
  sheet: string;
  kind: RowKind;
  /** The description as the file wrote it. */
  text: string;
  /** What was matched: the core of the description with its size column. */
  name: string;
  /** The section it sits under, read as context. */
  ctx: string;
  unitRaw: string;
  qRaw: string;
  qty: string;
  /** The quantity as the file wrote it — the base of every recalculation until the user types his own. */
  qFile: string;
  qEdit: boolean;
  unitOk: boolean;
  inc: boolean;
  removed: boolean;
  why: RowWhy[];
  nodeId: string | null;
  specs: SpecChoice[];
  free: string[];
  brand: number | null;
  /** Not in the list: kept as the file wrote it, under a sub-category (`sub`) so suppliers are reached. */
  outside: boolean;
  sub: string | null;
  how: MatchHow | 'user';
  suggestions: string[];
  ctxRow: number | null;
  /** The place of the chosen unit among the material's units. */
  u: number;
  conv: { q: string; u: string } | null;
  ask: boolean;
}

export type IgnoredKind = 'note' | 'grand' | 'emptysheet' | 'title' | 'total' | 'vat' | 'hdr2' | 'noname' | 'hidden' | 'summary' | 'nosheet' | 'lump' | 'neg' | 'removed';

export interface IgnoredLine {
  kind: IgnoredKind;
  row: number | null;
  sheet: string;
  text: string;
  /** The place in the review's rows, when the user can bring it back. */
  at: number | null;
}

export interface MaterialsRead {
  rows: ImportRow[];
  ignored: ReadonlyArray<IgnoredRow>;
  sheetsRead: string[];
  dataRows: number;
  res: ReadResult;
  ok: boolean;
  help: ReadSheetInfo | null;
  unfilled: boolean;
}

const blankRow = (r: Pick<ImportRow, 'row' | 'sheet' | 'text' | 'name' | 'ctx' | 'unitRaw' | 'qRaw' | 'qty'>): ImportRow => ({
  ...r,
  kind: 'row',
  qFile: r.qty,
  qEdit: false,
  unitOk: false,
  inc: true,
  removed: false,
  why: [],
  nodeId: null,
  specs: [],
  free: [],
  brand: null,
  outside: false,
  sub: null,
  how: 'none',
  suggestions: [],
  ctxRow: null,
  u: 0,
  conv: null,
  ask: false,
});

const withMatch = (r: ImportRow, m: MaterialMatch): ImportRow => ({
  ...r,
  nodeId: m.nodeId,
  specs: m.specs,
  free: m.free,
  brand: m.brand,
  how: m.how,
  suggestions: m.suggestions,
});

/** Recalculates the unit of a row after its material, its quantity or its unit changed. */
export function evaluateUnit(r: ImportRow, matcher: Matcher): ImportRow {
  const why = r.why.filter(w => w !== 'unit');
  if (!r.nodeId) return { ...r, why, u: 0, conv: null, ask: false, qty: r.qEdit ? r.qty : r.qFile };
  const u = readUnit({ units: unitsOf(matcher.index, r.nodeId), unitRaw: r.unitRaw, fileQty: r.qFile, edited: r.qEdit, confirmed: r.unitOk, qty: r.qty });
  return { ...r, why: u.unknown ? [...why, 'unit'] : why, u: u.u, conv: u.conv, ask: u.ask, qty: u.qty };
}

export const isRow = (r: ImportRow): boolean => r.kind === 'row' && r.inc;
export const isReady = (r: ImportRow): boolean => (r.nodeId != null || r.outside) && Number(r.qty) > 0 && !r.why.includes('unit');
export const needsYou = (r: ImportRow): boolean => isRow(r) && !isReady(r);
export const isNone = (r: ImportRow): boolean => r.nodeId == null && !r.outside && r.how === 'none';

const TITLE_IS_HEADING = /(^|\s)(اعمال|الاعمال|بند|باب|قسم|works|work|bill|section|division|part)(\s|$)/;

const segments = (c: string): number => String(c || '').split(/[.\-/]/).filter(Boolean).length;

/** Every stage: the file's sheets → its structure → the material of each line. Nothing is dropped silently. */
export function readMaterials(book: Book, grids: Grid[], matcher: Matcher, memory: MaterialMemory | null, opt?: UnderstandOptions): MaterialsRead {
  const res = understand(book, grids, opt || {});
  const base = { res, help: res.help, ok: res.items.length > 0, dataRows: res.items.length, unfilled: !!res.unfilled };
  if (res.items.length > MATERIALS_MAX_ROWS) return { ...base, rows: [], ignored: [], sheetsRead: [] };
  const rows: ImportRow[] = res.items.map((B: ReadItem) => {
    const sib = B.code && B.title && B.title.code && segments(B.code) === segments(B.title.code);
    const name = stripMark([coreText(B.desc), B.spec].filter(Boolean).join(' ')) || B.desc;
    const ctx = !sib && B.title && B.title.text && norm(B.title.text) !== norm(name) ? stripMark(coreText(B.title.text)) : '';
    const r = blankRow({
      row: B.row as number,
      sheet: B.sheet,
      text: B.desc,
      name,
      ctx,
      unitRaw: B.unitRaw || '',
      qRaw: B.qRaw,
      qty: B.qty != null && B.qty > 0 ? String(Number(B.qty.toFixed(3))) : '',
    });
    if (B.sumOnly || B.prov || B.pct || isLump(B.unitRaw)) return { ...r, kind: 'lump', inc: false };
    if (B.qty != null && B.qty < 0) return { ...r, kind: 'neg', inc: false };
    const m = matcher.match(name, ctx, memory);
    let out = withMatch(r, m);
    if (m.how === 'ctx' && B.title) out = { ...out, ctxRow: B.title.row };
    if (!out.qty) out = { ...out, why: ['noqty'] };
    out = evaluateUnit(out, matcher);
    return isNone(out) ? { ...out, inc: false } : out;
  });

  // A list of materials, not a BOQ: a line with no quantity and no unit may be a material whose writer forgot the quantity.
  const used = new Set(rows.filter(r => r.how === 'ctx').map(r => r.ctxRow));
  const asRow = new Set<ReadRow>();
  res.titles
    .filter(x => x.tobj)
    .forEach(T => {
      const z = norm(T.desc);
      if (TITLE_IS_HEADING.test(z) || used.has(T.row) || (T.code && /^[A-Za-z]$|^\d{1,2}$/.test(T.code))) return;
      const S = res.sheets.find(x => x.sheet === T.sheet);
      if (S && S.roles && S.roles.some(x => x === 'code' || x === 'rate' || x === 'amount')) return;
      if (/[:：]\s*$/.test(T.desc) || (/[A-Z]{3}/.test(T.desc) && !/[a-z]/.test(T.desc))) return;
      const name = stripMark(T.desc);
      const m = matcher.match(name, '', memory);
      if (m.how !== 'cat' && m.how !== 'mem') return;
      asRow.add(T);
      rows.push(evaluateUnit(withMatch({ ...blankRow({ row: T.row as number, sheet: T.sheet, text: T.desc, name, ctx: '', unitRaw: '', qRaw: '', qty: '' }), why: ['noqty'] }, m), matcher));
    });
  const sheetOrder = (n: string): number => book.sheets.findIndex(s => s.name === n);
  rows.sort((a, b) => sheetOrder(a.sheet) - sheetOrder(b.sheet) || a.row - b.row);

  const ignored = res.ignored
    .concat(res.titles.filter(x => !asRow.has(x)))
    .filter(x => (x as ReadRow).kind !== 'cont')
    .sort((a, b) => ((a as ReadRow).row ? 1 : 0) - ((b as ReadRow).row ? 1 : 0) || sheetOrder(a.sheet) - sheetOrder(b.sheet) || ((a as ReadRow).row || 0) - ((b as ReadRow).row || 0));
  return { ...base, rows, ignored, sheetsRead: [...new Set(res.items.map(x => x.sheet))] };
}

/** «تجاهلنا»: what the reader left out, then the works, the deductions and what the user removed — each with its place when it can come back. */
export function ignoredLines(read: MaterialsRead, rows: ImportRow[]): IgnoredLine[] {
  const fromReader = read.ignored.map((x): IgnoredLine => {
    const r = x as ReadRow;
    return { kind: x.kind as IgnoredKind, row: r.row ?? null, sheet: x.sheet, text: r.desc || '', at: null };
  });
  const fromRows = rows.flatMap((r, at): IgnoredLine[] =>
    r.kind !== 'row' || r.removed ? [{ kind: r.removed ? 'removed' : (r.kind as 'lump' | 'neg'), row: r.row, sheet: r.sheet, text: r.text, at }] : [],
  );
  return [...fromReader, ...fromRows];
}

export async function loadMaterialsFile(name: string, buf: ArrayBuffer | Uint8Array): Promise<{ book: Book; grids: Grid[] }> {
  if (buf.byteLength > MATERIALS_MAX_MB * 1048576) throw new MaterialsFileError('size');
  try {
    const { book, grids } = await loadBook(name, buf);
    return { book, grids };
  } catch (e) {
    if (e instanceof BoqLoadError) throw new MaterialsFileError(e.code);
    throw e;
  }
}

/** Reads a file all the way: the structure, the materials, and the refusals the PRD names (section 6). */
export async function understandMaterialsFile(name: string, buf: ArrayBuffer | Uint8Array, matcher: Matcher, memory: MaterialMemory | null): Promise<{ book: Book; grids: Grid[]; read: MaterialsRead }> {
  const { book, grids } = await loadMaterialsFile(name, buf);
  const read = readMaterials(book, grids, matcher, memory);
  if (read.dataRows > MATERIALS_MAX_ROWS) throw new MaterialsFileError('rows');
  if (!read.ok && !read.help) throw new MaterialsFileError(read.unfilled ? 'unfilled' : 'noitems');
  return { book, grids, read };
}
