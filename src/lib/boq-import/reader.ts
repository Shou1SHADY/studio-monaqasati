import type { Grid } from './xfile';

export type { Grid } from './xfile';

export interface BookSheet {
  name: string;
  hidden?: boolean;
}

export interface Book {
  sheets: BookSheet[];
}

export type HeaderRole = 'code' | 'serial' | 'desc' | 'spec' | 'unit' | 'qty' | 'rate' | 'amount' | 'note';
export type ColumnRole = HeaderRole | 'desc2' | 'skip';
export type RowKind = 'item' | 'title' | 'cont' | 'hdr2' | 'note' | 'total' | 'vat' | 'grand' | 'noname';
export type WhyFlag = 'noqty' | 'neg' | 'comma' | 'mismatch' | 'dup' | 'nodesc';

export interface NumParse {
  v: number | null;
  rest: string;
  empty?: boolean;
  text?: string;
  pct?: boolean;
  neg?: boolean;
  comma?: boolean;
}

export interface TitleRef {
  text: string;
  code: string;
  sheet: string;
  row: number;
}

export interface ReadRow {
  sheet: string;
  row: number | null;
  code: string;
  desc: string;
  alt: string;
  spec: string;
  unitRaw: string;
  why: WhyFlag[];
  kind: RowKind;
  qRaw: string;
  amt?: number | null;
  tobj?: TitleRef;
  title?: TitleRef | null;
  unit?: string;
  amtW?: number | null;
  rateW?: number | null;
  prov?: boolean;
  qty?: number | null;
  qComma?: boolean;
  rate?: number | null;
  incl?: boolean;
  pct?: boolean;
  sumOnly?: boolean;
  qText?: string;
  rateFromAmt?: boolean;
  calc?: number;
  amtNote?: string;
  cont?: number[];
  dupOf?: (number | null)[];
  ok?: WhyFlag[];
  removed?: boolean;
  manual?: boolean;
}

export interface ReadItem extends ReadRow {
  kind: 'item';
  unit: string;
  qty: number | null;
  rate: number | null;
  title: TitleRef | null;
  amtW: number | null;
  rateW: number | null;
}

export interface TotalRef {
  v: number;
  row: number;
}

export interface SheetRead {
  sheet: string;
  hdr: number;
  roles: ColumnRole[];
  width: number;
  rows: ReadRow[];
  ok: boolean;
  grand: TotalRef | null;
  hasCode: boolean;
  byContent: boolean;
  swapped: boolean;
  endTotal?: TotalRef | null;
}

export interface ReadSheetInfo extends SheetRead {
  k: number;
}

export interface FileTotal {
  v: number;
  row?: number;
  sheet?: string;
  sheets?: number;
}

export interface IgnoredSheet {
  sheet: string;
  kind: 'hidden' | 'emptysheet' | 'summary' | 'nosheet';
  cand?: number | null;
}

export type IgnoredRow = IgnoredSheet | ReadRow;

export interface ReadResult {
  eu: boolean;
  sheets: ReadSheetInfo[];
  items: ReadItem[];
  ignored: IgnoredRow[];
  titles: ReadRow[];
  grand: FileTotal | null;
  help: ReadSheetInfo | null;
  sumSheet?: { sheet: string; v: number; row: number };
  ends?: ({ sheet: string; v: number; row: number } | null)[];
  unfilled?: boolean;
  guess?: { sheet: string; how: 'content' | 'swap' }[];
}

export interface ReadSheetOptions {
  eu: boolean;
  hdr?: number;
  roles?: ColumnRole[];
  lone?: ColumnRole;
}

export interface UnderstandOptions {
  sheet?: number;
  hdr?: number;
  roles?: ColumnRole[];
  lone?: ColumnRole;
}

const HDR_SCAN = 30;
export const digits = (s: unknown): string =>
  String(s == null ? '' : s)
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const INVIS = /[​-‏‪-‮⁦-⁩﻿]/g;
export const clean = (s: unknown): string =>
  String(s == null ? '' : s)
    .replace(INVIS, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
export const norm = (s: unknown): string =>
  clean(s)
    .toLowerCase()
    .replace(/[ً-ْ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
export const hasLetters = (s: unknown): boolean => /[A-Za-zء-ي]/.test(digits(s));
const nLet = (s: unknown): number => (digits(s).match(/[A-Za-zء-ي]/g) || []).length;

export const HW: Record<HeaderRole, string[]> = {
  code: ['رقم البند', 'رقم', 'البند', 'الرمز', 'رمز البند', 'الكود', 'item', 'item no', 'item no.', 'item code', 'ref', 'ref.', 'code', 'no', 'no.', 'bill item'],
  serial: ['م', 'ت', 'مسلسل', 'تسلسل', 'sn', 's n', 's/n', '#', 'seq'],
  desc: [
    'الوصف',
    'وصف البند',
    'وصف الاعمال',
    'البيان',
    'بيان الاعمال',
    'description',
    'descr',
    'descr.',
    'desc',
    'item description',
    'description of work',
    'particulars',
    'الماده',
    'المواد',
    'اسم الماده',
    'الصنف',
    'الاصناف',
    'اسم الصنف',
    'material',
    'materials',
    'item name',
  ],
  spec: ['المقاس', 'مقاس', 'القياس', 'المواصفات', 'مواصفات', 'المواصفه', 'الابعاد', 'القطر', 'size', 'spec', 'specs', 'specification', 'dimensions', 'dia'],
  unit: ['الوحده', 'وحده', 'وحده القياس', 'unit', 'units', 'uom', 'u/m', 'u m'],
  qty: ['الكميه', 'الكميات', 'كميه', 'العدد', 'qty', "q'ty", 'qnty', 'quantity', 'quantities'],
  rate: ['سعر الوحده', 'السعر', 'سعر', 'الفئه', 'فئه', 'سعر البيع', 'rate', 'unit rate', 'u/r', 'u r', 'unit price', 'price'],
  amount: ['الاجمالي', 'اجمالي', 'المبلغ', 'مبلغ', 'القيمه', 'الاجمالي (ريال)', 'amount', 'amt', 'amt (sar)', 'total', 'total price', 'total amount', 'value'],
  note: ['ملاحظات', 'ملاحظه', 'notes', 'note', 'remarks', 'remark', 'comments'],
};

const hParts = (cell: unknown): string[] =>
  norm(cell)
    .split(/\n|\/|\|/)
    .map(x => x.replace(/[():#*·]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

export function hdrRole(cell: unknown): HeaderRole | null {
  for (const z of hParts(cell)) {
    if (HW.serial.includes(z)) return 'serial';
    if (HW.rate.some(w => z === w || z.startsWith(w + ' '))) return 'rate';
    if (HW.amount.some(w => z === w || z.startsWith(w + ' '))) return 'amount';
    if (HW.qty.some(w => z === w || z.startsWith(w + ' '))) return 'qty';
    if (HW.unit.some(w => z === w || z.startsWith(w + ' '))) return 'unit';
    if (HW.spec.some(w => z === w || z.startsWith(w + ' '))) return 'spec';
    if (HW.desc.some(w => z === w || z.startsWith(w + ' '))) return 'desc';
    if (HW.code.some(w => z === w || z.startsWith(w + ' '))) return 'code';
    if (HW.note.some(w => z === w || z.startsWith(w + ' '))) return 'note';
  }
  return null;
}

export const hdrScore = (row: unknown[]): number => {
  const r = row.map(c => hdrRole(c));
  const has = (k: HeaderRole): boolean => r.includes(k);
  const num = row.filter(x => /^\s*[\d.,٬٫٠-٩]+\s*$/.test(String(x || '')) && String(x).trim()).length;
  if (num || !has('desc')) return 0;
  const n = (['code', 'unit', 'qty', 'rate', 'amount', 'spec'] as HeaderRole[]).filter(has).length;
  return n >= 2 || has('qty') ? n : 0;
};

export function findHdr(g: Grid): number {
  let best = -1;
  let sc = 0;
  for (let r = 0; r < Math.min(HDR_SCAN, g.length); r++) {
    const s = hdrScore(g[r] || []);
    if (s > sc) {
      sc = s;
      best = r;
    }
  }
  return best;
}

const CUR = /(sar|s\.r|sr|ريال|ر\.س|رس|\uFDFC|\u20C1)/gi;
const EU_RE = /^-?\d{1,3}(\.\d{3})+(,\d+)?$|^-?\d+,\d{1,2}$/;
const US_RE = /^-?\d{1,3}(,\d{3})+(\.\d+)?$|^-?\d+\.\d{1,3}$/;
const numText = (s: unknown): string =>
  digits(clean(s))
    .replace(CUR, '')
    .replace(/٬/g, ',')
    .replace(/٫/g, '.')
    .replace(/(\d)\s+(?=\d{3}\b)/g, '$1')
    .trim();

export function detectEU(sheets: Grid[]): boolean {
  let eu = 0;
  let us = 0;
  sheets.forEach(g =>
    g.forEach(r =>
      r.forEach(c => {
        const t = numText(c).replace(/[()%]/g, '');
        if (!/\d/.test(t) || hasLetters(t)) return;
        if (EU_RE.test(t)) eu++;
        else if (US_RE.test(t)) us++;
      }),
    ),
  );
  return eu > us;
}

export function pNum(s: unknown, eu?: boolean): NumParse {
  const raw = clean(s);
  if (!raw || /^[-–—]+$/.test(raw) || /^n\/?a$/i.test(raw)) return { v: null, rest: '', empty: true };
  let t = numText(raw);
  let neg = false;
  let pct = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1).trim();
  }
  const m = t.match(/^-?[\d.,]+%?/);
  if (!m) return { v: null, rest: '', text: raw };
  let n = m[0];
  const rest = t.slice(m[0].length).replace(/^[\s)]+/, '').trim();
  if (n.endsWith('%')) {
    pct = true;
    n = n.slice(0, -1);
  }
  let comma = false;
  if (eu) n = n.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d{1,2}$/.test(n)) {
    n = n.replace(',', '.');
    comma = true;
  } else n = n.replace(/,/g, '');
  let v = Number(n);
  if (!isFinite(v)) return { v: null, rest: '', text: raw };
  if (neg) v = -v;
  if (pct) v = v / 100;
  return { v, rest, pct, neg, comma };
}

export const isNumCell = (s: unknown, eu?: boolean): boolean => {
  const p = pNum(s, eu);
  return p.v != null && !hasLetters(p.rest);
};

const UNIT_STD: Record<string, string> = {
  'م3': 'م³',
  'م٣': 'م³',
  m3: 'م³',
  cum: 'م³',
  cbm: 'م³',
  'متر مكعب': 'م³',
  'م2': 'م²',
  'م٢': 'م²',
  m2: 'م²',
  sqm: 'م²',
  'm²': 'م²',
  'متر مربع': 'م²',
  'م.ط': 'م.ط',
  مط: 'م.ط',
  'م ط': 'م.ط',
  lm: 'م.ط',
  rm: 'م.ط',
  'l.m': 'م.ط',
  m: 'م',
  م: 'م',
  متر: 'م',
  ton: 'طن',
  tons: 'طن',
  t: 'طن',
  طن: 'طن',
  kg: 'كجم',
  كجم: 'كجم',
  no: 'عدد',
  'no.': 'عدد',
  nos: 'عدد',
  nr: 'عدد',
  ea: 'عدد',
  each: 'عدد',
  pcs: 'عدد',
  pc: 'عدد',
  عدد: 'عدد',
  حبه: 'عدد',
  قطعه: 'عدد',
  pt: 'نقطة',
  نقطه: 'نقطة',
  point: 'نقطة',
  ls: 'مقطوعية',
  'l.s': 'مقطوعية',
  'l.s.': 'مقطوعية',
  'lump sum': 'مقطوعية',
  lumpsum: 'مقطوعية',
  sum: 'مقطوعية',
  item: 'مقطوعية',
  lot: 'مقطوعية',
  مقطوعيه: 'مقطوعية',
  مقطوع: 'مقطوعية',
  مقطوعه: 'مقطوعية',
  'prov sum': 'مقطوعية',
  'prov. sum': 'مقطوعية',
  'provisional sum': 'مقطوعية',
  provisional: 'مقطوعية',
  ps: 'مقطوعية',
  'p.s': 'مقطوعية',
  'pc sum': 'مقطوعية',
  'p.c. sum': 'مقطوعية',
  'مبلغ احتياطي': 'مقطوعية',
  احتياطي: 'مقطوعية',
  'مبلغ تقديري': 'مقطوعية',
  ساعه: 'ساعة',
  hr: 'ساعة',
  hour: 'ساعة',
  يوم: 'يوم',
  day: 'يوم',
  شهر: 'شهر',
  month: 'شهر',
  '%': '%',
  لتر: 'لتر',
  l: 'لتر',
};
const unitKey = (raw: unknown): string => norm(raw).replace(/\s+/g, ' ');
export const unitStd = (raw: unknown): string => {
  const k = unitKey(raw);
  return UNIT_STD[k] || UNIT_STD[k.replace(/\./g, '')] || clean(raw);
};
export const knownUnit = (raw: unknown): boolean => {
  const k = unitKey(raw);
  return !!(UNIT_STD[k] || UNIT_STD[k.replace(/\./g, '')]);
};
export const isLump = (u: unknown): boolean => unitStd(u) === 'مقطوعية';

const TOT = [
  'page 1',
  'page 2',
  'page 3',
  'page 4',
  'page 5',
  'صفحه',
  'الصفحه',
  'المجموع',
  'مجموع',
  'الاجمالي',
  'اجمالي',
  'المرحل',
  'مرحل',
  'المنقول',
  'منقول',
  'total',
  'sub-total',
  'subtotal',
  'sub total',
  'page total',
  'carried',
  'brought forward',
  'brought',
  'collection',
  'to collection',
  'to summary',
  'ما قبله',
  'ماقبله',
  'ما بعده',
  'منقول من',
  'نقل الى',
];
const GRAND = ['الاجمالي العام', 'اجمالي عام', 'الاجمالي الكلي', 'المجموع الكلي', 'المجموع العام', 'grand total', 'total tender sum', 'tender total', 'contract sum', 'total boq', 'total contract'];
const VAT = ['ضريبه', 'القيمه المضافه', 'vat', 'v.a.t'];
const NOTE = ['ملاحظه', 'ملاحظات', 'note', 'notes', 'nb', 'n.b', 'n.b.'];
const PREVAT = /قبل الضريبه|بدون الضريبه|بدون ضريبه|غير شامل الضريبه|before vat|excl\.? vat|excluding vat|ex\.? vat|net of vat/;
const startsAny = (z: string, W: string[]): boolean => W.some(w => z === w || z.startsWith(w + ' ') || z.startsWith(w + ':'));
const CONT = /^(و|يشمل|ويشمل|شامل|بما في|including|incl|to include|complete with|and )/i;
const isHead = (s: string): boolean => /[:：]\s*$/.test(s) || (/[A-Z]{3}/.test(s) && !/[a-z]/.test(s));
const INCLUDED = ['مشمول', 'مشموله', 'included', 'incl', 'incl.', 'inc', 'by others', 'بالمجان', 'مجانا'];
const PROV = /^(provisional sum|prov\.? sum|p\.?\s?c\.? sum|allow for|مبلغ احتياطي|مبلغ تقديري|مبلغ مقطوع)/;
const codeOk = (s: unknown): boolean =>
  /^[A-Za-zء-ي]{0,4}[\s.\-]?[\d٠-٩]+([.\-/][\dA-Za-z٠-٩ء-ي]+)*$/.test(clean(s)) || /^[A-Za-zء-ي]{1,3}$/.test(clean(s));

interface ColStat {
  k: number;
  cnt: number;
  num: number;
  let: number;
  unit: number;
  avgL: number;
  code: number;
  serial: boolean;
}

function colStats(rows: Grid, width: number, eu: boolean): ColStat[] {
  return Array.from({ length: width }, (_, k) => {
    const v = rows.map(r => clean(r[k])).filter(Boolean);
    const n = v.length || 1;
    const nums = v.map(x => pNum(x, eu)).filter(p => p.v != null && !hasLetters(p.rest));
    return {
      k,
      cnt: v.length,
      num: nums.length / n,
      let: v.filter(hasLetters).length / n,
      unit: v.filter(knownUnit).length / n,
      avgL: v.reduce((a, x) => a + nLet(x), 0) / n,
      code: v.filter(x => codeOk(x) && !knownUnit(x)).length / n,
      serial: v.length > 2 && v.every((x, j) => j === 0 || Number(digits(x)) === Number(digits(v[j - 1])) + 1),
    };
  });
}

function rolesFromHdr(g: Grid, hdr: number, width: number): ColumnRole[] {
  const roles: ColumnRole[] = Array(width).fill('skip');
  const H = g[hdr] || [];
  for (let k = 0; k < width; k++) {
    const r = hdrRole(H[k] || '');
    if (r && r !== 'serial' && r !== 'note') roles[k] = r;
  }
  const descs = roles.map((x, k) => (x === 'desc' ? k : -1)).filter(k => k >= 0);
  if (descs.length > 1) {
    const ar = (k: number): number => g.slice(hdr + 1, hdr + 60).filter(r => /[ء-ي]/.test(String(r[k] || ''))).length;
    descs.sort((a, b) => ar(b) - ar(a));
    descs.slice(1).forEach((k, i) => {
      roles[k] = i === 0 ? 'desc2' : 'skip';
    });
  }
  (['code', 'unit', 'qty', 'rate', 'amount'] as ColumnRole[]).forEach(role => {
    const ks = roles.map((x, k) => (x === role ? k : -1)).filter(k => k >= 0);
    ks.slice(1).forEach(k => {
      roles[k] = 'skip';
    });
  });
  return roles;
}

function rolesFromContent(rows: Grid, width: number, eu: boolean, lone?: ColumnRole): ColumnRole[] {
  const st = colStats(rows, width, eu);
  const roles: ColumnRole[] = Array(width).fill('skip');
  const desc = st.filter(s => s.cnt && s.let >= 0.6 && s.unit < 0.5).sort((a, b) => b.avgL - a.avgL)[0];
  if (desc) roles[desc.k] = 'desc';
  const unit = st.filter(s => roles[s.k] === 'skip' && s.unit >= 0.5).sort((a, b) => b.unit - a.unit)[0];
  if (unit) roles[unit.k] = 'unit';
  const code = st.filter(s => roles[s.k] === 'skip' && !s.serial && s.code >= 0.6 && s.cnt).sort((a, b) => b.code - a.code)[0];
  if (code) roles[code.k] = 'code';
  const numc = st.filter(s => roles[s.k] === 'skip' && !s.serial && s.num >= 0.6).map(s => s.k);
  if (numc.length === 1) roles[numc[0]] = lone || 'qty';
  else
    numc.forEach((k, i) => {
      roles[k] = (['qty', 'rate', 'amount'] as ColumnRole[])[i] || 'skip';
    });
  return roles;
}

function fixByArithmetic(rows: Grid, roles: ColumnRole[], eu: boolean): ColumnRole[] {
  const ks = (['qty', 'rate', 'amount'] as ColumnRole[]).map(r => roles.indexOf(r));
  if (ks.some(k => k < 0)) return roles;
  const perms = [
    [0, 1, 2],
    [1, 0, 2],
    [0, 2, 1],
    [2, 0, 1],
    [1, 2, 0],
    [2, 1, 0],
  ];
  const score = (p: number[]): number =>
    rows.reduce((a, r) => {
      const q = pNum(r[ks[p[0]]], eu).v;
      const rt = pNum(r[ks[p[1]]], eu).v;
      const am = pNum(r[ks[p[2]]], eu).v;
      return a + (q != null && rt != null && am != null && am !== 0 && Math.abs(q * rt - am) <= Math.max(1, Math.abs(am) * 0.001) ? 1 : 0);
    }, 0);
  const sc = perms.map(score);
  const best = sc.indexOf(Math.max(...sc));
  if (best > 0 && sc[best] > sc[0]) {
    const out = roles.slice();
    const p = perms[best];
    out[ks[p[0]]] = 'qty';
    out[ks[p[1]]] = 'rate';
    out[ks[p[2]]] = 'amount';
    return out;
  }
  return roles;
}

const rolesOk = (roles: ColumnRole[]): boolean => roles.includes('desc') && roles.includes('qty');

const NO_NUM: NumParse = { v: null, rest: '' };

export function readSheet(g: Grid, sh: string, opt: ReadSheetOptions): SheetRead {
  const eu = opt.eu;
  const width = Math.max(0, ...g.map(r => r.length));
  const hdr = opt.hdr != null ? opt.hdr : findHdr(g);
  let roles: ColumnRole[];
  const data = g.slice(hdr + 1).filter(r => r.some(x => clean(x)));
  if (opt.roles) roles = opt.roles;
  else if (hdr >= 0) roles = rolesFromHdr(g, hdr, width);
  else roles = rolesFromContent(data.slice(0, 120), width, eu, opt.lone);
  const r0 = roles;
  roles = fixByArithmetic(data.slice(0, 200), roles, eu);
  const out: SheetRead = {
    sheet: sh,
    hdr,
    roles,
    width,
    rows: [],
    ok: rolesOk(roles),
    grand: null,
    hasCode: roles.includes('code'),
    byContent: hdr < 0 && !opt.roles,
    swapped: roles !== r0,
  };
  if (!out.ok) return out;
  const K = (r: ColumnRole): number => roles.indexOf(r);
  const ci = K('code');
  const di = K('desc');
  const d2 = K('desc2');
  const ui = K('unit');
  const qi = K('qty');
  const ri = K('rate');
  const ai = K('amount');
  const si = roles.map((x, k) => (x === 'spec' ? k : -1)).filter(k => k >= 0);
  const H = hdr >= 0 ? (g[hdr] || []).map(norm).join('|') : null;
  let title: TitleRef | null = null;
  let last: ReadRow | null = null;
  let inNote = false;
  for (let r = hdr + 1; r < g.length; r++) {
    const c = (g[r] || []).map(x => (x == null ? '' : x));
    if (!c.some(x => clean(x))) continue;
    const code = ci >= 0 ? clean(c[ci]) : '';
    const desc = clean(c[di]);
    const alt = d2 >= 0 ? clean(c[d2]) : '';
    const unitRaw = ui >= 0 && !/^([-–—]+|n\/?a|لا ينطبق)$/i.test(clean(c[ui])) ? clean(c[ui]) : '';
    const Q = qi >= 0 ? pNum(c[qi], eu) : NO_NUM;
    const Rt = ri >= 0 ? pNum(c[ri], eu) : NO_NUM;
    const A = ai >= 0 ? pNum(c[ai], eu) : NO_NUM;
    const R: ReadRow = {
      sheet: sh,
      row: r + 1,
      code,
      desc: desc || alt,
      alt: desc ? alt : '',
      spec: si.map(k => clean(c[k])).filter(Boolean).join(' '),
      unitRaw,
      why: [],
      kind: 'item',
      qRaw: qi >= 0 ? clean(c[qi]) : '',
    };
    const z = norm(desc || alt || code);
    const anyText = norm(c.filter((_x, k) => k !== qi && k !== ri && k !== ai).join(' '));
    if (H && c.map(norm).join('|') === H) {
      R.kind = 'hdr2';
      out.rows.push(R);
      continue;
    }
    if (hdr >= 0 && hdrScore(c) >= 2) {
      R.kind = 'hdr2';
      out.rows.push(R);
      continue;
    }
    if (startsAny(z, NOTE) || startsAny(anyText, NOTE)) {
      R.kind = 'note';
      inNote = true;
      out.rows.push(R);
      continue;
    }
    if (inNote && Q.v == null && A.v == null && Rt.v == null) {
      R.kind = 'note';
      if (!R.desc) R.desc = clean(c.filter(Boolean).join(' '));
      out.rows.push(R);
      continue;
    }
    inNote = false;
    if (PREVAT.test(anyText) && (A.v != null || Rt.v != null)) {
      R.kind = 'total';
      const amt = A.v != null ? A.v : (Rt.v as number);
      R.amt = amt;
      out.endTotal = { v: amt, row: r + 1 };
      out.rows.push(R);
      continue;
    }
    if (startsAny(z, VAT) || startsAny(anyText, VAT) || / vat\b|الضريبه/.test(' ' + z)) {
      R.kind = 'vat';
      R.amt = A.v;
      out.rows.push(R);
      continue;
    }
    if ((startsAny(z, GRAND) || startsAny(anyText, GRAND)) && !/شامل|incl|with vat/.test(anyText)) {
      R.kind = 'grand';
      R.amt = A.v != null ? A.v : Rt.v;
      if (out.grand == null && R.amt != null) out.grand = { v: R.amt, row: r + 1 };
      out.rows.push(R);
      continue;
    }
    if (startsAny(z, TOT) || startsAny(anyText, TOT) || /^page \d+/.test(z)) {
      R.kind = 'total';
      R.amt = A.v != null ? A.v : Rt.v;
      if (R.amt != null && !/شامل|incl/.test(anyText)) out.endTotal = { v: R.amt, row: r + 1 };
      out.rows.push(R);
      continue;
    }
    if (!R.desc) {
      const tx = c
        .map(clean)
        .filter((x, k) => k < di && k !== qi && k !== ri && k !== ai && k !== ui && nLet(x) >= 3)
        .join(' ');
      if (tx && Q.v == null && !unitRaw && A.v == null) {
        R.desc = tx;
        R.kind = 'title';
        title = { text: tx, code: '', sheet: sh, row: r + 1 };
        R.tobj = title;
        last = null;
        out.rows.push(R);
        continue;
      }
      R.kind = 'noname';
      out.rows.push(R);
      continue;
    }
    const hasQty = Q.v != null;
    const qText = qi >= 0 && !hasQty && !Q.empty ? clean(c[qi]) : '';
    const unitIn = unitRaw || (hasQty && Q.rest && !/^\(/.test(Q.rest) ? Q.rest : '');
    const hasNum = hasQty || Rt.v != null || A.v != null || !!unitIn || !!qText;
    if (!hasNum && !code && last && !isHead(R.desc) && (CONT.test(R.desc) || (out.hasCode && R.desc.length > 60))) {
      last.desc += ' ' + R.desc;
      if (d2 >= 0 && clean(c[d2]) && clean(c[d2]) !== R.desc) last.alt = (last.alt ? last.alt + ' ' : '') + clean(c[d2]);
      (last.cont = last.cont || []).push(r + 1);
      R.kind = 'cont';
      out.rows.push(R);
      continue;
    }
    if (!hasQty && !unitIn && !qText && !(Rt.v != null && A.v == null)) {
      R.kind = 'title';
      R.amt = A.v;
      title = { text: R.desc, code, sheet: sh, row: r + 1 };
      R.tobj = title;
      last = null;
      out.rows.push(R);
      continue;
    }
    R.title = title;
    R.unit = unitIn ? unitStd(unitIn) : '';
    R.unitRaw = unitIn;
    R.amtW = A.v;
    R.rateW = Rt.v;
    if ((Q.rest && /^\(/.test(Q.rest)) || /مؤقت|provisional|prov\b/i.test(Q.rest || '') || PROV.test(z)) R.prov = true;
    R.qty = hasQty ? Q.v : null;
    R.qComma = !!Q.comma;
    R.rate = Rt.v;
    if (Rt.v == null && ri >= 0 && Rt.text && INCLUDED.includes(norm(Rt.text))) {
      R.rate = 0;
      R.incl = true;
    }
    if (Q.pct) R.pct = true;
    if (!hasQty && A.v != null && (isLump(unitIn) || !unitIn)) {
      R.qty = 1;
      R.rate = A.v;
      R.sumOnly = true;
      if (!R.unit) R.unit = 'مقطوعية';
    } else if (!hasQty && isLump(unitIn) && Rt.v != null) R.qty = 1;
    if (R.qty == null) {
      R.why.push('noqty');
      if (qText) R.qText = qText;
    } else if (R.qty < 0) R.why.push('neg');
    if (Q.comma || Rt.comma) R.why.push('comma');
    if (R.rate == null && R.qty != null && A.v != null && R.qty !== 0 && !R.sumOnly) {
      R.rate = A.v / R.qty;
      R.rateFromAmt = true;
    }
    if (R.qty != null && R.rate != null && A.v != null && !R.sumOnly && !R.rateFromAmt) {
      const calc = R.qty * R.rate;
      if (Math.abs(calc - A.v) > 1) {
        R.why.push('mismatch');
        R.calc = calc;
      }
    }
    if (A.text) R.amtNote = A.text;
    out.rows.push(R);
    last = R;
    out.endTotal = null;
  }
  return out;
}

const SUMMARY_W = ['ملخص', 'الملخص', 'summary', 'collection', 'main summary', 'general summary'];

export function understand(book: Book, grids: Grid[], opt?: UnderstandOptions): ReadResult {
  const o0: UnderstandOptions = opt || {};
  const vis = book.sheets.map((s, k) => ({ s, k })).filter(x => !x.s.hidden);
  const eu = detectEU(vis.map(x => grids[x.k] || []));
  const res: ReadResult = { eu, sheets: [], items: [], ignored: [], titles: [], grand: null, help: null };
  book.sheets.forEach(s => {
    if (s.hidden) res.ignored.push({ sheet: s.name, kind: 'hidden' });
  });
  for (const x of vis) {
    const g = grids[x.k] || [];
    if (!g.some(r => r.some(c => clean(c)))) {
      res.ignored.push({ sheet: x.s.name, kind: 'emptysheet' });
      continue;
    }
    const o: ReadSheetOptions = o0.sheet === x.k && o0.roles ? { eu, hdr: o0.hdr, roles: o0.roles, lone: o0.lone } : { eu, lone: o0.lone };
    const isSum = SUMMARY_W.some(w => norm(x.s.name).includes(w)) && !(o0.sheet === x.k);
    const base: SheetRead = isSum
      ? { sheet: x.s.name, hdr: -1, roles: [], width: 0, rows: [], ok: false, grand: null, hasCode: false, byContent: false, swapped: false }
      : readSheet(g, x.s.name, o);
    const S: ReadSheetInfo = Object.assign(base, { k: x.k });
    res.sheets.push(S);
    const items = S.ok ? S.rows.filter(r => r.kind === 'item') : [];
    if (!S.ok || !items.length) {
      const gt = S.ok ? S.grand : null;
      let lastNum = null as TotalRef | null;
      let afterVat = false;
      if (!gt)
        g.forEach((r, i) => {
          const t = norm(r.join(' '));
          if (afterVat) return;
          if (!PREVAT.test(t) && (VAT.some(w => t.includes(w)) || /الضريبه|vat/.test(t))) {
            afterVat = lastNum != null;
            return;
          }
          if (startsAny(t, GRAND) || GRAND.some(w => t.includes(w)) || (SUMMARY_W.some(w => norm(x.s.name).includes(w)) && TOT.some(w => t.includes(w)))) {
            const n = r
              .map(c => pNum(c, eu))
              .filter(p => p.v != null && !hasLetters(p.rest))
              .pop();
            if (n) lastNum = { v: n.v as number, row: i + 1 };
          }
        });
      const found = gt || lastNum;
      if (found) res.sumSheet = { sheet: x.s.name, v: found.v, row: found.row };
      res.ignored.push({ sheet: x.s.name, kind: isSum || (res.sumSheet && res.sumSheet.sheet === x.s.name) ? 'summary' : 'nosheet', cand: !S.ok && g.length > 3 ? x.k : null });
      continue;
    }
    S.rows.forEach(r => {
      if (r.kind === 'item') res.items.push(r as ReadItem);
      else if (r.kind === 'title') res.titles.push(r);
      else if (r.kind !== 'cont') res.ignored.push(r);
    });
    if (S.grand && !res.grand) res.grand = Object.assign({ sheet: x.s.name }, S.grand);
    (res.ends = res.ends || []).push(S.endTotal ? Object.assign({ sheet: x.s.name }, S.endTotal) : null);
  }
  if (!res.grand && res.sumSheet) res.grand = res.sumSheet;
  if (!res.grand && res.ends && res.ends.length) {
    const full = res.ends.filter((e): e is { sheet: string; v: number; row: number } => e != null);
    if (full.length === res.ends.length) res.grand = full.length === 1 ? full[0] : { v: full.reduce((a, e) => a + e.v, 0), sheets: full.length };
  }
  res.unfilled = !res.items.length && res.sheets.some(S => S.ok && S.hdr >= 0 && !S.rows.some(r => r.kind === 'item'));
  if (!res.items.length && !res.unfilled) {
    const cand = res.sheets
      .filter(S => !S.ok && (grids[S.k] || []).filter(r => r.some(c => pNum(c, eu).v != null && clean(c))).length >= 2)
      .sort((a, b) => (grids[b.k] || []).length - (grids[a.k] || []).length)[0];
    if (cand) res.help = cand;
  }
  res.guess = res.sheets
    .filter(S => S.ok && (S.byContent || S.swapped) && S.rows.some(r => r.kind === 'item'))
    .map(S => ({ sheet: S.sheet, how: S.byContent ? ('content' as const) : ('swap' as const) }));
  const seen: Record<string, ReadItem[]> = {};
  res.items.forEach(R => {
    if (!/\d/.test(R.code)) return;
    const k = R.sheet + '|' + norm(R.code);
    (seen[k] = seen[k] || []).push(R);
  });
  Object.values(seen).forEach(a => {
    if (a.length > 1)
      a.forEach(R => {
        R.dupOf = a.filter(y => y !== R).map(y => y.row);
        R.why.push('dup');
      });
  });
  return res;
}
