import { understand as readerUnderstand } from './reader';
import type { Book, FileTotal, Grid, ReadItem, ReadResult, UnderstandOptions, WhyFlag } from './reader';

export const MAX_ROWS = 5000;
export const MAX_MB = 10;

export const understand = (book: Book, grids: Grid[], opt?: UnderstandOptions): ReadResult =>
  readerUnderstand(book, grids, { lone: 'amount', ...(opt || {}) });

const NEED: WhyFlag[] = ['noqty', 'mismatch', 'dup', 'comma', 'neg', 'nodesc'];

export const needs = (R: ReadItem): WhyFlag[] => R.why.filter(w => NEED.includes(w) && !(R.ok || []).includes(w));

export const amountOf = (R: ReadItem): number => (R.qty != null && R.rate != null ? R.qty * R.rate : 0);

export interface BoqTotals {
  n: number;
  sum: number;
  written: number;
  unpriced: number;
  need: number;
}

export function totals(_res: ReadResult, live: ReadItem[]): BoqTotals {
  const L = live.filter(R => !R.removed);
  const sum = L.reduce((a, R) => a + amountOf(R), 0);
  const written = L.reduce((a, R) => a + (R.amtW != null ? R.amtW : amountOf(R)), 0);
  return { n: L.length, sum, written, unpriced: L.filter(R => R.rate == null).length, need: L.filter(R => needs(R).length).length };
}

export const matchesFileTotal = (sum: number, grand: FileTotal | null): boolean | null => (grand ? Math.abs(sum - grand.v) <= 1 : null);

export interface AwardMatch {
  ok: boolean;
  d: number;
  pct: number;
}

export function matchAward(sum: number, contract: number): AwardMatch {
  const d = sum - contract;
  return { ok: Math.abs(d) <= 1, d, pct: contract ? (Math.abs(d) / contract) * 100 : 0 };
}
