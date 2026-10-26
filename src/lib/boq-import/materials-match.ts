import { BLOCKING_WORDS, DEFAULT_QUERY, HEAD_DEFAULT, KEYWORDS } from './materials-lexicon';
import {
  EQUIVALENT,
  LEADW,
  LEN,
  NEGW,
  OPTSYN,
  POP,
  QUAL,
  STOPW,
  SYNW,
  TAILW,
  UCANON,
  UNITW,
  WORKM,
  dimensionGroups,
  isNum,
  joinDims,
  norm,
  numEq,
  searchToks,
  splitUnit,
  synKey,
} from './materials-text';
import { pathOf } from '@/lib/materials/tree';
import type { MaterialIndex } from '@/lib/materials/tree';
import type { MaterialNode, MaterialText } from '@/lib/materials/types';

/** What a company remembers of a file text: the material the user picked for it, with the values chosen. */
export interface MaterialMemoryEntry {
  text: string;
  nodeId: string;
  specs: Array<{ spec: string; option: string }>;
  brand: string | null;
}

export type MaterialMemory = ReadonlyMap<string, MaterialMemoryEntry>;

/** A spec value chosen for a material, by place in the material's own spec list. */
export interface SpecChoice {
  spec: number;
  option: number;
}

export type MatchHow = 'cat' | 'mem' | 'ctx' | 'pick' | 'none';

export interface MaterialMatch {
  nodeId: string | null;
  specs: SpecChoice[];
  free: string[];
  brand: number | null;
  how: MatchHow;
  /** The closest materials (node ids) when none is sure. */
  suggestions: string[];
}

export interface MatchCandidate {
  nodeId: string;
  score: number;
  specs: SpecChoice[];
  free: string[];
  brand: number | null;
  /** The text named the head of the material's name itself. */
  headHit: boolean;
  /** Share of the material's name words the text mentions. */
  coverage: number;
  keyword: boolean;
}

interface OptionLex {
  a: string[];
  b: string[];
  all: string[];
  full: string;
}

interface Token {
  t: string;
  unit: string | null;
  forms: string[];
  base: string[];
  tv: string[];
  sig: boolean;
  num: boolean;
  purpose: boolean;
  qual: boolean;
  tail: boolean;
  soft: boolean;
}

interface LeafLex {
  id: string;
  ord: number;
  level: number;
  node: MaterialNode;
  words: Set<string>;
  nameWords: number;
  arN: Array<string[]>;
  enN: Array<string[]>;
  HW: Set<string>;
  NW: Set<string>;
  HN: Set<string>;
  negs: Array<{ neg: string; wf: string[] }>;
  specs: OptionLex[][];
  brands: Array<Set<string>>;
  brandWords: Set<string>;
  keywordWords: Set<string>;
}

export interface Matcher {
  index: MaterialIndex;
  match(name: string, ctx?: string | null, memory?: MaterialMemory | null): MaterialMatch;
  search(query: string): MatchCandidate[];
  loose(query: string): string[];
  materialNamed(ar: string): string | null;
  specsOf(nodeId: string): MaterialNode['specs'];
  brandsOf(nodeId: string): MaterialText[];
  /** The query a text becomes: the head hard, the tail and what is in brackets soft. */
  query(text: string): string;
}

const enHead = (en: unknown): string => {
  const s = norm(String(en || '').replace(/\([^)]*\)/g, ' ').split(' - ')[0]).split(' ').filter(Boolean);
  return s.length ? s[s.length - 1] : '';
};

const fixThousands = (x: string): string => x.replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1');

const uniq = <T>(a: T[]): T[] => [...new Set(a)];

export function buildMatcher(index: MaterialIndex): Matcher {
  const leaves = index.materials;
  const firstByName = new Map<string, string>();
  for (const n of index.byId.values()) if (!firstByName.has(n.ar)) firstByName.set(n.ar, n.id);
  const order = new Map<string, number>();
  [...index.byId.keys()].forEach((id, k) => order.set(id, k));

  const hay = new Map<string, string>();
  for (const n of leaves) hay.set(n.id, norm(pathOf(index, n.id).map(p => `${p.ar} ${p.en || p.ar}`).join(' ')));
  const kwOf = (n: MaterialNode): string[] => (KEYWORDS[n.ar] ? KEYWORDS[n.ar].slice() : []);
  const keywordSet = new Map<string, Set<string>>();
  for (const n of leaves) {
    const extra = kwOf(n);
    if (extra.length) hay.set(n.id, `${hay.get(n.id)} ${norm(extra.join(' '))}`);
    keywordSet.set(n.id, new Set(norm(extra.join(' ')).split(' ').filter(Boolean)));
  }

  const vocab = new Set<string>();
  for (const n of leaves)
    (hay.get(n.id) as string).split(' ').forEach(w => {
      if (w) {
        vocab.add(w);
        if (/^ال/.test(w) && w.length > 4) vocab.add(w.slice(2));
      }
    });

  const prefixes = (t: string): string[] => {
    const v: string[] = [];
    if (/^لل/.test(t) && t.length > 4) v.push('ال' + t.slice(2), t.slice(2));
    if (/^(وال|بال|فال|كال)/.test(t) && t.length > 5) v.push(t.slice(1), t.slice(3));
    if (/^و/.test(t) && !/^وال/.test(t) && t.length > 4) v.push(t.slice(1));
    if (/^ال/.test(t) && t.length > 4) v.push(t.slice(2));
    if (/^ب/.test(t) && !/^بال/.test(t) && t.length > 4 && !vocab.has(t) && vocab.has(t.slice(1))) v.push(t.slice(1));
    return v;
  };
  const suffixes = (t: string): string[] => {
    const v: string[] = [];
    if (t.length > 4 && /ات$/.test(t)) v.push(t.slice(0, -2));
    if (t.length > 3 && /ه$/.test(t)) v.push(t.slice(0, -1));
    if (t.length > 4 && /(ين|ون)$/.test(t)) v.push(t.slice(0, -2));
    if (t.length > 5 && /يه$/.test(t)) v.push(t.slice(0, -2));
    if (t.length > 5 && /[\u0600-\u06FF]ي$/.test(t)) v.push(t.slice(0, -1));
    if (/^[a-z]{4,}ing$/.test(t)) v.push(t.slice(0, -3));
    if (/^[a-z]{4,}s$/.test(t)) v.push(t.slice(0, -1));
    if (/^[a-z]{3,}es$/.test(t)) v.push(t.slice(0, -2));
    if (/^[a-z]{3,}ies$/.test(t)) v.push(t.slice(0, -3) + 'y');
    return v;
  };
  const synonymsOf = (t: string): readonly string[] => (Object.prototype.hasOwnProperty.call(SYNW, t) ? SYNW[t] : []);
  const optionSynonymsOf = (t: string): readonly string[] => (Object.prototype.hasOwnProperty.call(OPTSYN, t) ? OPTSYN[t] : []);
  const forms = (t: string): string[] => {
    const b = [t, ...synonymsOf(t), ...prefixes(t)];
    return uniq(b.concat(...b.map(suffixes)));
  };
  const formsCache = new Map<string, string[]>();
  const formsOf = (t: string): string[] => {
    let v = formsCache.get(t);
    if (!v) {
      v = forms(t);
      formsCache.set(t, v);
    }
    return v;
  };
  const wordForms = (s: string): Set<string> => {
    const out = new Set<string>();
    s.split(' ')
      .filter(Boolean)
      .forEach(w => formsOf(w).forEach(f => out.add(f)));
    return out;
  };

  const lex = new Map<string, LeafLex>();
  for (const n of leaves) {
    const nz = norm(n.ar) + ' ' + norm(n.en || n.ar);
    const arw = norm(n.ar).split(' ').filter(Boolean);
    const kw = [...(keywordSet.get(n.id) as Set<string>)];
    const negs: LeafLex['negs'] = [];
    const nzw = nz.replace(/-/g, ' ').split(' ');
    nzw.forEach((w, k) => {
      if (NEGW.has(w) && nzw[k + 1]) negs.push({ neg: w, wf: formsOf(nzw[k + 1]) });
    });
    const nameW = (s: string): string[][] =>
      s
        .split(' ')
        .filter(w => w.length > 2 && !STOPW.has(w))
        .map(formsOf);
    const brandWords = (b: MaterialText): string[] => (norm(b.ar) + ' ' + norm(b.en || '')).split(' ').filter(Boolean);
    lex.set(n.id, {
      id: n.id,
      ord: order.get(n.id) as number,
      level: n.level,
      node: n,
      words: new Set(nz.split(' ').flatMap(w => [w, w.replace(/^ال/, '')])),
      nameWords: arw.length,
      arN: nameW(norm(n.ar)),
      enN: nameW(norm(String(n.en || n.ar).replace(/[()&,-]/g, ' '))),
      HW: wordForms(hay.get(n.id) as string),
      NW: new Set([...wordForms(nz), ...kw]),
      HN: new Set([...formsOf(arw[0] || ''), ...formsOf(enHead(n.en || n.ar)), ...kw]),
      negs,
      specs: n.specs.map(s =>
        s.options.map(o => {
          const a = norm(o.ar).split(' ').map(fixThousands);
          const b = norm(o.en || '').split(' ').map(fixThousands);
          return { a, b, all: uniq(a.concat(b)), full: norm(o.ar) + ' ' };
        }),
      ),
      brands: n.brands.map(b => new Set(brandWords(b))),
      brandWords: new Set(n.brands.flatMap(brandWords)),
      keywordWords: keywordSet.get(n.id) as Set<string>,
    });
  }
  const L = (id: string): LeafLex => lex.get(id) as LeafLex;

  const prepTok = (t00: string): Token => {
    const { text: t0, unit } = splitUnit(t00);
    const soft0 = t0[0] === '~';
    const t = soft0 ? t0.slice(1) : t0;
    const f = formsOf(t);
    const purpose = (/^لل/.test(t) && t.length > 4) || (/^ل[^ل]/.test(t) && t.length > 3 && formsOf(t.slice(1)).some(x => QUAL.has(x)));
    const qual = f.some(x => QUAL.has(x));
    return {
      t,
      unit,
      forms: f,
      base: [t, ...synonymsOf(t), ...prefixes(t)],
      tv: [t, ...synonymsOf(t), ...optionSynonymsOf(t), ...suffixes(t), ...prefixes(t)],
      sig: t.length >= 4 && !UNITW.has(t) && !isNum(t),
      num: isNum(t),
      purpose,
      qual,
      tail: soft0,
      soft: soft0 || purpose || qual,
    };
  };

  const optUnit = (o: OptionLex): string | null => UCANON.get(o.a[o.a.length - 1]) || null;
  const numFit = (T: Token, o: OptionLex): boolean => {
    const u = optUnit(o);
    if (!T.unit || !u) return T.tv.some(x => o.a[0] === x || numEq(o.a[0], x));
    const lt = LEN[T.unit];
    const lu = LEN[u];
    if (lt && lu) return isNum(o.a[0]) && !/\//.test(o.a[0] + T.t) && Math.abs(Number(T.t) * lt - Number(o.a[0]) * lu) < 0.01;
    return T.unit === u && (o.a[0] === T.t || numEq(o.a[0], T.t));
  };

  const searchCache = new Map<string, MatchCandidate[]>();
  function search(q: string): MatchCandidate[] {
    const cached = searchCache.get(q);
    if (cached) return cached;
    const toks = searchToks(q);
    if (!toks.length) return [];
    const out: MatchCandidate[] = [];
    const TK = toks.map(prepTok);
    const QF = new Map<string, number>();
    TK.forEach((T, j) =>
      T.tv.concat(T.forms).forEach(f => {
        if (!QF.has(f)) QF.set(f, j);
      }),
    );
    const dims = dimensionGroups(q.replace(/~/g, ''));
    for (const leaf of leaves) {
      const X = L(leaf.id);
      let score = 0;
      let hard = 0;
      let hh = false;
      let kwHit = false;
      let ok = true;
      let brand: number | null = null;
      const sp = new Map<number, number>();
      const free: string[] = [];
      const used = new Set<number>();
      dims.forEach(parts => {
        const key = parts.join(' ') + ' ';
        X.specs.forEach((opts, k) => {
          if (sp.has(k)) return;
          const oi = opts.findIndex(o => o.full.startsWith(key));
          if (oi < 0) return;
          sp.set(k, oi);
          score += 1;
          hard++;
          parts.forEach(p => {
            const x = TK.findIndex((z, j) => z.t === p && !used.has(j));
            if (x >= 0) used.add(x);
          });
        });
      });
      for (let j = 0; j < TK.length && ok; j++) {
        if (used.has(j)) continue;
        const T = TK[j];
        const t = T.t;
        if (T.forms.some(f => X.HW.has(f))) {
          const nameLevel = T.forms.some(f => X.NW.has(f));
          if (T.soft && !nameLevel) continue;
          const isKw = T.forms.some(f => X.keywordWords.has(f));
          if (isKw) kwHit = true;
          score += isKw ? 3.5 : T.base.some(f => X.words.has(f)) ? 3 : nameLevel ? 2.5 : 2;
          if (!T.soft) {
            hard++;
            if (T.forms.some(f => X.HN.has(f))) hh = true;
          }
          continue;
        }
        let best: { k: number; oi: number; rank: number; tie: boolean } | null = null;
        X.specs.forEach((opts, k) => {
          if (sp.has(k)) return;
          opts.forEach((o, oi) => {
            const first = T.num ? numFit(T, o) : T.tv.some(x => o.a[0] === x || o.b[0] === x);
            const w = first
              ? 2
              : (T.sig && !T.tail && T.tv.some(x => o.all.includes(x))) || (T.num && o.a.some(x => /^[a-z]+\d/.test(x) && x.replace(/^[a-z]+/, '') === t))
                ? 1
                : 0;
            if (!w) return;
            const cov = o.all.filter(x => QF.has(x)).length;
            const rank = w * 100 + cov * 10 - o.all.length;
            if (!best || rank > best.rank) best = { k, oi, rank, tie: false };
            else if (best.k === k && rank === best.rank) best.tie = true;
          });
        });
        const chosen = best as { k: number; oi: number; rank: number; tie: boolean } | null;
        if (chosen && !chosen.tie) {
          sp.set(chosen.k, chosen.oi);
          score += 1;
          if (!T.soft) hard++;
          X.specs[chosen.k][chosen.oi].all.forEach(x => {
            const jj = QF.get(x);
            if (jj != null && jj !== j && !TK[jj].forms.some(f => X.NW.has(f))) used.add(jj);
          });
          continue;
        }
        const bi: number = brand == null ? X.brands.findIndex(b => b.has(t)) : -1;
        if (bi >= 0) {
          brand = bi;
          score += 1;
          if (!T.soft) hard++;
          continue;
        }
        if (T.num) {
          if (!T.soft) free.push(t);
          continue;
        }
        if (T.soft) continue;
        ok = false;
      }
      if (!ok || score <= 0 || !hard) continue;
      if (X.negs.some(n => !QF.has(n.neg) && n.wf.some(f => QF.has(f)))) score -= 2.5;
      const covOf = (N: string[][]): number => (N.length ? N.filter(F => F.some(f => QF.has(f))).length / N.length : 0);
      const cov = Math.max(covOf(X.arN), covOf(X.enN));
      const blocked = (BLOCKING_WORDS[X.node.ar] || []).some(w => QF.has(norm(w)));
      out.push({
        nodeId: leaf.id,
        score: score + (hh ? 1 : 0) + (POP.has(X.node.ar) ? 0.5 : 0),
        specs: [...sp].sort((x, y) => x[0] - y[0]).map(([spec, option]) => ({ spec, option })),
        free,
        brand,
        headHit: hh && !blocked,
        coverage: cov,
        keyword: kwHit,
      });
    }
    out.sort((a, b) => b.score - a.score || L(a.nodeId).level - L(b.nodeId).level || L(a.nodeId).ord - L(b.nodeId).ord);
    const res = out.slice(0, 6);
    if (searchCache.size > 2000) searchCache.clear();
    searchCache.set(q, res);
    return res;
  }

  const nameHit = (id: string, q: string): boolean =>
    searchToks(q)
      .map(prepTok)
      .some(T => !T.soft && T.t.length > 1 && !T.num && T.forms.some(f => L(id).NW.has(f)));

  const looseCache = new Map<string, string[]>();
  function loose(q: string): string[] {
    const cached = looseCache.get(q);
    if (cached) return cached;
    const all = searchToks(q)
      .map(prepTok)
      .filter(T => T.t.length > 1 && !T.num && !T.qual && !T.purpose);
    if (!all.length) return [];
    const core0 = all.filter(T => !T.tail);
    const core = core0.length ? core0 : all;
    const F0 = core[0].forms;
    if (searchToks(q).some(t => t[0] !== '~' && WORKM.has(t))) {
      looseCache.set(q, []);
      return [];
    }
    const out: Array<{ id: string; nh: number; h: number; hn: number; head: number; w: number }> = [];
    for (const leaf of leaves) {
      const X = L(leaf.id);
      let nh = 0;
      let nc = 0;
      let h = 0;
      let bh = 0;
      let hn = 0;
      all.forEach(T => {
        const f = T.forms;
        if (f.some(x => X.NW.has(x))) {
          nh++;
          h++;
          if (!T.tail) nc++;
          if (f.some(x => X.HN.has(x))) hn++;
        } else if (!T.tail && f.some(x => X.HW.has(x))) h++;
        else if (X.brandWords.has(T.t)) bh++;
      });
      const head = F0.some(x => X.NW.has(x));
      if (nc && (hn || head || (nh + bh) * 2 >= core.length)) out.push({ id: leaf.id, nh, h, hn: Math.min(hn, 1), head: head ? 1 : 0, w: X.nameWords });
    }
    out.sort(
      (a, b) =>
        b.nh - a.nh ||
        b.hn - a.hn ||
        b.head - a.head ||
        b.h - a.h ||
        a.w - b.w ||
        (POP.has(L(b.id).node.ar) ? 1 : 0) - (POP.has(L(a.id).node.ar) ? 1 : 0) ||
        L(a.id).level - L(b.id).level ||
        L(a.id).ord - L(b.id).ord,
    );
    const res = out.slice(0, 6).map(x => x.id);
    if (looseCache.size > 2000) looseCache.clear();
    looseCache.set(q, res);
    return res;
  }

  function query(s: string): string {
    const out: string[] = [];
    let depth = 0;
    let tail = false;
    let hardN = 0;
    String(s || '')
      .replace(EQUIVALENT, ' ')
      .replace(/["“”«»[\]{}:：]/g, ' ')
      .replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1')
      .replace(/\(/g, ' ( ')
      .replace(/\)/g, ' ) ')
      .replace(/[،,;]/g, ' , ')
      .split(/\s+/)
      .filter(Boolean)
      .forEach(w => {
        if (w === '(') {
          depth++;
          return;
        }
        if (w === ')') {
          depth = Math.max(0, depth - 1);
          return;
        }
        if (w === ',') {
          if (hardN) tail = true;
          return;
        }
        const z = norm(w);
        const qual = formsOf(z).some(f => QUAL.has(f));
        if (
          !tail &&
          !depth &&
          hardN &&
          !qual &&
          (TAILW.has(z) ||
            (/^ب/.test(z) && !/^بال/.test(z) && z.length >= 4 && !vocab.has(z) && !vocab.has(z.slice(1))) ||
            (/^بال/.test(z) && !vocab.has(z.slice(1))))
        )
          tail = true;
        if (!hardN && !depth && LEADW.has(z)) return;
        if (depth || tail) out.push('~' + w);
        else {
          out.push(w);
          hardN++;
        }
      });
    return out.join(' ');
  }

  const firstHard = (q: string): string | undefined => searchToks(q).find(t => t[0] !== '~');
  const clearTop = (r: MatchCandidate[]): boolean => {
    const b = r[0];
    const s2 = r[1];
    return !!b && b.score >= 3 && (!s2 || b.score - s2.score >= 1 || (POP.has(L(b.nodeId).node.ar) && !POP.has(L(s2.nodeId).node.ar)));
  };
  const strong = (x: MatchCandidate | undefined): boolean => !!x && x.headHit && (x.coverage >= 0.5 || x.keyword);

  const materialNamed = (ar: string): string | null => firstByName.get(ar) ?? null;
  const own = (o: Readonly<Record<string, string>>, k: string | undefined): string | undefined => (k != null && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

  const memoryMatch = (m: MaterialMemoryEntry): MaterialMatch | null => {
    const X = lex.get(m.nodeId);
    if (!X) return null;
    const specs: SpecChoice[] = [];
    for (const want of m.specs) {
      const k = X.node.specs.findIndex(s => s.ar === want.spec);
      const o = k >= 0 ? X.node.specs[k].options.findIndex(x => x.ar === want.option) : -1;
      if (k >= 0 && o >= 0) specs.push({ spec: k, option: o });
    }
    const brand = m.brand == null ? -1 : X.node.brands.findIndex(b => b.ar === m.brand);
    return { nodeId: m.nodeId, specs, free: [], brand: brand >= 0 ? brand : null, how: 'mem', suggestions: [] };
  };
  const found = (c: MatchCandidate, name: string, how: MatchHow): MaterialMatch => ({ nodeId: c.nodeId, specs: c.specs, free: joinDims(name, c.free), brand: c.brand, how, suggestions: [] });

  function match(name: string, ctx?: string | null, memory?: MaterialMemory | null): MaterialMatch {
    const key = synKey(name);
    const dq = own(DEFAULT_QUERY, key);
    const dn = dq ? materialNamed(dq) : null;
    if (dn) return { nodeId: dn, specs: [], free: [], brand: null, how: 'cat', suggestions: [] };
    const remembered = memory?.get(key);
    const fromMemory = remembered ? memoryMatch(remembered) : null;
    if (fromMemory) return fromMemory;
    const q = query(name);
    const r = search(q);
    if (clearTop(r) && strong(r[0])) return found(r[0], name, 'cat');
    const hd = own(HEAD_DEFAULT, firstHard(q));
    const hx = hd ? r.slice(0, 2).find(x => L(x.nodeId).node.ar === hd) || (r[1] && r[0].score === r[1].score ? r.find(x => L(x.nodeId).node.ar === hd) : undefined) : undefined;
    if (hx && strong(hx) && r[0].score - hx.score < 1) return found(hx, name, 'cat');
    const full = ctx ? query(ctx) + ' ' + q : null;
    const rc = full ? search(full) : [];
    if (full && clearTop(rc) && strong(rc[0])) return found(rc[0], name, 'ctx');
    let sugg = uniq([...r.filter(x => nameHit(x.nodeId, q)).map(x => x.nodeId), ...loose(q), ...(full ? loose(full) : [])]);
    const hdn = hd ? materialNamed(hd) : null;
    if (hdn && sugg.includes(hdn)) sugg = [hdn, ...sugg.filter(x => x !== hdn)];
    sugg = sugg.slice(0, 3);
    return { nodeId: null, specs: [], free: [], brand: null, how: sugg.length ? 'pick' : 'none', suggestions: sugg };
  }

  return {
    index,
    match,
    search: q => search(q),
    loose: q => loose(q),
    materialNamed,
    specsOf: id => L(id).node.specs,
    brandsOf: id => L(id).node.brands,
    query,
  };
}

const cache = new WeakMap<MaterialIndex, Matcher>();
export function matcherOf(index: MaterialIndex): Matcher {
  let m = cache.get(index);
  if (!m) {
    m = buildMatcher(index);
    cache.set(index, m);
  }
  return m;
}
