import { inflateSync } from 'fflate';

export type Grid = string[][];
export type BinaryInput = ArrayBuffer | Uint8Array;

export interface SheetMeta {
  name: string;
  hidden: boolean;
  path?: string;
}

export interface Workbook {
  kind: 'xlsx' | 'csv';
  enc?: string;
  sep?: string;
  sheets: SheetMeta[];
  load: (sheet: SheetMeta) => Promise<Grid>;
}

export type XlsxCell = string | number | { f: string } | null | undefined;

export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
  bold?: number[];
  boldTx?: number[];
  rtl?: boolean;
  freeze?: boolean;
  hidden?: boolean;
  widths?: number[];
  list?: { ref: string; items: string[] };
}

interface ZipEntry {
  flags: number;
  method: number;
  csize: number;
  loff: number;
}

const td = new TextDecoder();

const readU8 = (buf: BinaryInput): Uint8Array => new Uint8Array(buf);

export async function unzip(buf: BinaryInput): Promise<{ names: string[]; read: (name: string) => Promise<string | null> }> {
  const u8 = readU8(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('notzip');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files: Record<string, ZipEntry> = {};
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('notzip');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true);
    const xl = dv.getUint16(p + 30, true);
    const cl = dv.getUint16(p + 32, true);
    const loff = dv.getUint32(p + 42, true);
    files[td.decode(u8.subarray(p + 46, p + 46 + nl))] = { flags, method, csize, loff };
    p += 46 + nl + xl + cl;
  }
  const read = async (name: string): Promise<string | null> => {
    const f = files[name];
    if (!f) return null;
    if (f.flags & 1) throw new Error('protected');
    const s = f.loff + 30 + dv.getUint16(f.loff + 26, true) + dv.getUint16(f.loff + 28, true);
    const data = u8.subarray(s, s + f.csize);
    if (f.method === 0) return td.decode(data);
    if (f.method === 8) return td.decode(inflateSync(data));
    throw new Error('method');
  };
  return { names: Object.keys(files), read };
}

export const colIdx = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export const colName = (index: number): string => {
  let s = '';
  let k = index + 1;
  while (k > 0) {
    const m = (k - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    k = Math.floor((k - 1) / 26);
  }
  return s;
};

const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xml = (s: string): Document => new DOMParser().parseFromString(s, 'application/xml');
const txt = (el: Element): string =>
  Array.from(el.getElementsByTagName('t'))
    .filter(t => t.parentNode?.nodeName !== 'rPh')
    .map(t => t.textContent)
    .join('');

async function readXlsx(buf: BinaryInput): Promise<Workbook> {
  const z = await unzip(buf);
  const wbx = await z.read('xl/workbook.xml');
  if (!wbx) throw new Error('notxlsx');
  const rels: Record<string, string> = {};
  Array.from(xml((await z.read('xl/_rels/workbook.xml.rels')) || '<r/>').getElementsByTagName('Relationship')).forEach(r => {
    rels[r.getAttribute('Id') ?? ''] = r.getAttribute('Target') ?? '';
  });
  const ssx = await z.read('xl/sharedStrings.xml');
  const SS: string[] = ssx ? Array.from(xml(ssx).getElementsByTagName('si')).map(txt) : [];
  const sheets: SheetMeta[] = Array.from(xml(wbx).getElementsByTagName('sheet')).map(s => {
    let t = rels[s.getAttributeNS(NS_R, 'id') || s.getAttribute('r:id') || ''] || '';
    t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    const state = s.getAttribute('state');
    return { name: s.getAttribute('name') ?? '', hidden: !!state && state !== 'visible', path: t };
  });
  const load = async (sh: SheetMeta): Promise<Grid> => {
    const D = xml((await z.read(sh.path ?? '')) || '<w/>');
    const rows: (string[] | undefined)[] = [];
    for (const r of Array.from(D.getElementsByTagName('row'))) {
      const ri = Number(r.getAttribute('r') || rows.length + 1) - 1;
      const row: (string | undefined)[] = [];
      let last = -1;
      for (const c of Array.from(r.getElementsByTagName('c'))) {
        const ref = c.getAttribute('r');
        const t = c.getAttribute('t');
        const k = ref ? colIdx(ref) : last + 1;
        last = k;
        const ve = c.getElementsByTagName('v')[0];
        let v = '';
        if (t === 's') v = SS[Number(ve && ve.textContent)] || '';
        else if (t === 'inlineStr') v = txt(c);
        else if (ve) {
          v = ve.textContent ?? '';
          if (t === 'b') v = v === '1' ? 'TRUE' : 'FALSE';
          else if (!t || t === 'n') v = String(Number(Number(v).toFixed(6)));
        }
        row[k] = v;
      }
      rows[ri] = Array.from(row, x => (x == null ? '' : String(x)));
    }
    return Array.from(rows, r => r || []);
  };
  return { kind: 'xlsx', sheets, load };
}

export function readCsv(buf: BinaryInput): Workbook {
  let text: string;
  let enc = 'UTF-8';
  const b0 = new Uint8Array(buf.slice(0, 2));
  if (b0[0] === 0xff && b0[1] === 0xfe) {
    text = new TextDecoder('utf-16le').decode(buf);
    enc = 'UTF-16';
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder('windows-1256').decode(buf);
      enc = 'Windows-1256';
    }
  }
  text = text.replace(/^﻿/, '');
  const head = text
    .split(/\r?\n/)
    .slice(0, 8)
    .join('\n')
    .replace(/"[^"]*"/g, '');
  const cnt = (ch: string): number => head.split(ch).length - 1;
  const sep = [',', ';', '\t', '|'].sort((a, b) => cnt(b) - cnt(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') q = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const grid = rows.map(r => r.map(x => x.trim()));
  return { kind: 'csv', enc, sep, sheets: [{ name: 'CSV', hidden: false }], load: async () => grid };
}

export type ReadFileError = 'protected' | 'broken' | 'xls' | 'type';

export async function read(name: string, buf: BinaryInput): Promise<Workbook> {
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
  if (/^xlsx$/i.test(ext)) {
    try {
      return await readXlsx(buf);
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      throw new Error(message === 'notzip' || message === 'protected' ? 'protected' : 'broken');
    }
  }
  if (/^(csv|txt|tsv)$/i.test(ext)) return readCsv(buf);
  throw new Error(/^xls$/i.test(ext) ? 'xls' : 'type');
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (u8: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zip(files: { name: string; data: string | Uint8Array }[]): Uint8Array {
  const te = new TextEncoder();
  const parts: Uint8Array[] = [];
  const cent: Uint8Array[] = [];
  let off = 0;
  files.forEach(f => {
    const nb = te.encode(f.name);
    const data = typeof f.data === 'string' ? te.encode(f.data) : f.data;
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(8, 0, true);
    h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nb.length, true);
    c.setUint32(42, off, true);
    cent.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + data.length;
  });
  const csz = cent.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, csz, true);
  e.setUint32(16, off, true);
  const all = [...parts, ...cent, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  all.forEach(a => {
    out.set(a, p);
    p += a.length;
  });
  return out;
}

const X = (s: unknown): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function xlsx(sheets: XlsxSheet[]): Uint8Array {
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + NS_R + '"';
  const ws = (sh: XlsxSheet): string => {
    const rows = sh.rows
      .map(
        (r, i) =>
          `<row r="${i + 1}">${r
            .map((v, k) => {
              if (v === '' || v == null) return '';
              const ref = colName(k) + (i + 1);
              const st = (sh.bold || []).includes(i) ? ' s="1"' : (sh.boldTx || []).includes(i) ? ' s="2"' : '';
              if (typeof v === 'object' && v.f) return `<c r="${ref}"${st}><f>${X(v.f)}</f></c>`;
              return typeof v === 'number'
                ? `<c r="${ref}"${st}><v>${v}</v></c>`
                : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${X(v)}</t></is></c>`;
            })
            .join('')}</row>`,
      )
      .join('');
    return (
      `${H}<worksheet ${NS}><sheetViews><sheetView ${sh.rtl ? 'rightToLeft="1" ' : ''}workbookViewId="0"${
        sh.freeze ? '><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>' : '/>'
      }</sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
      (sh.widths ? `<cols>${sh.widths.map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '') +
      `<sheetData>${rows}</sheetData>` +
      (sh.list
        ? `<dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="${sh.list.ref}"><formula1>"${X(sh.list.items.join(','))}"</formula1></dataValidation></dataValidations>`
        : '') +
      '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>'
    );
  };
  const files = [
    {
      name: '[Content_Types].xml',
      data: `${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map(
          (_s, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `${H}<workbook ${NS}><bookViews><workbookView/></bookViews><sheets>${sheets
        .map((s, i) => `<sheet name="${X(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`)
        .join('')}</sheets>${
        sheets.some(s => s.rows.some(r => r.some(v => v && typeof v === 'object'))) ? '<calcPr calcId="191029" fullCalcOnLoad="1"/>' : ''
      }</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_s, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: `${H}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3F7F4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: ws(s) })),
  ];
  return zip(files);
}

export function csv(rows: unknown[][], enc?: string, sep?: string): Uint8Array {
  const t =
    rows
      .map(r =>
        r
          .map(v => {
            const s = String(v == null ? '' : v);
            return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          })
          .join(sep || ','),
      )
      .join('\r\n') + '\r\n';
  if (enc !== 'windows-1256') return new TextEncoder().encode('﻿' + t);
  const rev: Record<string, number> = {};
  const d = new TextDecoder('windows-1256');
  for (let b = 128; b < 256; b++) rev[d.decode(new Uint8Array([b]))] = b;
  return new Uint8Array([...t].map(ch => (ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : rev[ch] || 63)));
}
