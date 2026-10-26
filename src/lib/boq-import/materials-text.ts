import { digits } from './reader';
import {
  LEAD_WORDS,
  NEGATION_WORDS,
  OPTION_SYNONYMS,
  POPULAR,
  QUALIFIER_WORDS,
  SPEC_UNIT_GROUPS,
  STOP_WORDS,
  SYNONYMS,
  TAIL_WORDS,
  UNIT_WORDS,
  WORK_WORDS,
} from './materials-lexicon';

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** The matcher's normal form: no diacritics, one alef, ة→ه, ى→ي, "×" and a digit-"x"-digit as a space. */
export const norm = (s: unknown): string =>
  String(s || '')
    .replace(INVISIBLE, '')
    .replace(/\u00A0/g, ' ')
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[×*]/g, ' ')
    .replace(/(\d)\s*x\s*(?=\d)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();

const normSet = (words: readonly string[]): ReadonlySet<string> => new Set(words.map(norm));

export const STOPW = normSet(STOP_WORDS);
export const UNITW = normSet(UNIT_WORDS);
export const QUAL = normSet(QUALIFIER_WORDS);
export const LEADW = normSet(LEAD_WORDS);
export const WORKM = normSet(WORK_WORDS);
export const TAILW = normSet(TAIL_WORDS);
export const NEGW = normSet(NEGATION_WORDS);
export const POP: ReadonlySet<string> = new Set(POPULAR);
export const SYNW = SYNONYMS;
export const OPTSYN = OPTION_SYNONYMS;

export const synKey = (s: unknown): string => norm(digits(s));

const NUM = /^\d+(\.\d+)?$|^\d+\/\d+$/;
export const isNum = (t: string): boolean => NUM.test(t);
export const numEq = (a: string, b: string): boolean => isNum(a) && isNum(b) && (a === b || (!/\//.test(a + b) && Number(a) === Number(b)));

/** The unit a number carries in a spec option or in the text: «10 سم» → cm. */
export const UCANON: ReadonlyMap<string, string> = new Map(SPEC_UNIT_GROUPS.flatMap(g => g.map(u => [norm(u), g[0]] as const)));
export const LEN: Readonly<Record<string, number>> = { mm: 1, cm: 10, m: 1000, in: 25.4 };

const UNIT_SEP = '¦';

/**
 * The hard and soft words of a text: filler words go, a number takes the unit written after it («10 سم» → 10¦cm),
 * a leading work word goes. A «~» marks a soft word.
 */
export function searchToks(q: string): string[] {
  const a = norm(
    digits(q)
      .replace(/(\d),(\d{3})\b/g, '$1$2')
      .replace(/(\d+(?:\.\d+)?)\s*(?:الف|ألف|k)(?=\s|$)/gi, (_m, n: string) => String(Math.round(Number(n) * 1000)))
      .replace(/["'“”«»()[\]{}:،,;]/g, ' '),
  )
    .replace(/(\d)([\u0600-\u06FF])/g, '$1 $2')
    .replace(/(^|\s)يو ?بي ?في ?سي(?=\s|$)/g, '$1upvc')
    .replace(/(^|\s)بي ?في ?سي(?=\s|$)/g, '$1pvc')
    .replace(/(^|\s)بي ?بي ?ار(?=\s|$)/g, '$1ppr')
    .split(' ')
    .filter(Boolean);
  const out: string[] = [];
  a.forEach((t0, k) => {
    const soft = t0[0] === '~';
    const t = soft ? t0.slice(1) : t0;
    const prev = k > 0 ? a[k - 1].replace(/^~/, '') : '';
    if (!t) return;
    if (STOPW.has(t) || (/^[لبو][^ل]/.test(t) && t.length > 3 && STOPW.has(t.slice(1)))) return;
    if (UNITW.has(t) && /^\d+(\.\d+)?$|^\d+\/\d+$/.test(prev)) {
      const last = out.length - 1;
      if (last >= 0 && out[last].replace(/^~/, '') === prev) out[last] += UNIT_SEP + t;
      return;
    }
    if (/^حراري/.test(t) && /^وحد/.test(prev)) return;
    if (!out.length && LEADW.has(t)) return;
    out.push(soft ? '~' + t : t);
  });
  return out;
}

export const splitUnit = (token: string): { text: string; unit: string | null } => {
  const [t, u] = token.split(UNIT_SEP);
  return { text: t, unit: u ? UCANON.get(u) || u : null };
};

/** A sub-item mark at the start of a description is dropped: «أ) قطر 12» · «b) 16 mm» · «(ii)» · «- ». */
const SUB_MARK = /^\s*(?:[(\[]?(?:[a-zA-Z]|[ivxIVX]{1,4}|[ء-ي]|\d{1,2})[)\]\-–.](?!\d)|[-–•▪·*])\s*/;
export const stripMark = (s: unknown): string => String(s || '').replace(SUB_MARK, '').trim();

/** The core of a description: what stands before the generic phrases of a BOQ («ويشمل السعر…», «حسب المواصفات», «including…»). */
const CUT = /\s(?:و?يشمل|شامل[اهة]?|و?بما في ذلك|و?حسب|و?وفق[ا\u064B]*|طبقا|مع جميع|وجميع ما|including|incl\.?|complete with|to include|as per|in accordance|according to)(?=\s|$)/i;
export function coreText(s: unknown): string {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  const m = t.match(CUT);
  if (m && m.index != null && m.index > 3) t = t.slice(0, m.index);
  return t.trim() || String(s || '').trim();
}

export const EQUIVALENT = /(?:أو|او)\s+(?:ما\s+)?(?:يعادل|يماثل|يكافئ)[هها]*|(?:أو|او)\s+مماثل|or\s+(?:approved\s+)?(?:equivalent|equal|similar)/gi;

export function dimensionGroups(text: string): string[][] {
  return (digits(text).match(/\d+(?:\.\d+)?(?:\s*[×xX*]\s*\d+(?:\.\d+)?)+/g) || []).map(g => g.split(/\s*[×xX*]\s*/));
}

/** Dimensions like «60×60» stay ONE free spec, not two numbers. */
export function joinDims(text: string, free: string[]): string[] {
  let out = free.slice();
  dimensionGroups(text).forEach(parts => {
    const tmp = out.slice();
    if (
      parts.every(p => {
        const k = tmp.indexOf(p);
        if (k < 0) return false;
        tmp.splice(k, 1);
        return true;
      })
    )
      out = tmp.concat(parts.join('×'));
  });
  return out;
}

/** A unit as the unit tables key it: normalised, digits western, no dots. */
export const unitNorm = (raw: unknown): string => norm(digits(raw)).replace(/\./g, '').trim();
