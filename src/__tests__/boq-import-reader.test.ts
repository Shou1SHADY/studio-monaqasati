/**
 * @jest-environment node
 *
 * The shared BOQ reader (customer package BOQ-Import-PM-1.0): the 27 files, the 22 template
 * deviations, the Mdmak template and the challenge BOQs must read exactly as the customer's
 * own test run did (Test-Results.txt, boq-27/expected.json).
 */

import fs from 'fs'
import path from 'path'
import { JSDOM } from 'jsdom'
import * as XL from 'xlsx'
import {
  BOQ_HOW_SHEET,
  BOQ_TEMPLATE_FILE,
  BOQ_TEMPLATE_SHEET,
  BOQ_UNITS,
  BoqLoadError,
  MAX_MB,
  MAX_ROWS,
  amountOf,
  buildBoqTemplate,
  csv,
  digits,
  hdrRole,
  loadBook,
  matchAward,
  matchesFileTotal,
  needs,
  pNum,
  read,
  readCsv,
  unzip,
  totals,
  understand as understandGeneric,
  understandPm as understand,
  unitStd,
  xlsx as writeXlsx,
} from '@/lib/boq-import'
import type { Book, Grid, ReadItem, ReadResult, WhyFlag, Workbook } from '@/lib/boq-import'

Object.assign(globalThis, { DOMParser: new JSDOM('').window.DOMParser })

const FIX = path.join(__dirname, '..', 'test-utils', 'fixtures', 'boq-import')
const bytesOf = (file: string): Uint8Array => new Uint8Array(fs.readFileSync(file))

interface Opened {
  book: Workbook
  grids: Grid[]
  res: ReadResult
  items: ReadItem[]
  sum: number
  need: number
  reasons: WhyFlag[]
  ignored: number
}

async function open(file: string): Promise<Opened> {
  const buf = bytesOf(file)
  const book = await read(path.basename(file), buf)
  const grids = await Promise.all(book.sheets.map(s => (s.hidden ? Promise.resolve([] as Grid) : book.load(s))))
  const res = understand(book, grids)
  const T = totals(res, res.items)
  const reasons = Array.from(new Set(res.items.flatMap(needs))).sort()
  return { book, grids, res, items: res.items, sum: T.sum, need: T.need, reasons, ignored: res.ignored.length }
}

interface Case {
  n: number
  sum: number
  grand: number | null
  need: number
  reasons: WhyFlag[]
  ignored: number
}

const SUM27 = 13872775
const c = (n: number, sum: number, grand: number | null, need: number, reasons: WhyFlag[], ignored: number): Case => ({ n, sum, grand, need, reasons, ignored })

const FILES_27: Record<string, Case> = {
  'c01_gov_arabic.xlsx': c(22, SUM27, SUM27, 0, [], 13),
  'c02_uk_bills.xlsx': c(22, SUM27, SUM27, 0, [], 47),
  'c03_reversed_with_gaps.xlsx': c(22, SUM27, null, 0, [], 0),
  'c04_messy_header.xlsx': c(23, SUM27, null, 0, [], 0),
  'c05_lettered_subitems.xlsx': c(22, SUM27, null, 0, [], 0),
  'c06_numeric_codes_qty_with_unit.xlsx': c(22, SUM27, null, 0, [], 0),
  'c07_numbers_as_text.xlsx': c(23, 13871175, null, 1, ['neg'], 0),
  'c08_blank_tender.xlsx': c(22, 0, null, 0, [], 1),
  'c09_stale_formulas.xlsx': c(22, SUM27, null, 0, [], 1),
  'c10_page_totals_english.xlsx': c(22, SUM27, SUM27, 0, [], 13),
  'c11_section_amount_on_title.xlsx': c(22, SUM27, null, 0, [], 0),
  'c12_percent_and_provisional.xlsx': c(25, 14936413.75, null, 0, [], 0),
  'c13_etimad_style_with_vat.xlsx': c(22, SUM27, SUM27, 0, [], 3),
  'c14_excel_unicode_text.txt': c(22, SUM27, null, 0, [], 0),
  'c15_windows_arabic.csv': c(22, SUM27, null, 0, [], 0),
  'c16_european.csv': c(22, SUM27, null, 0, [], 0),
  'c17_pdf_copy_paste.txt': c(22, SUM27, null, 0, [], 4),
  'c18_large.xlsx': c(3000, 285861300, 285861300, 0, [], 31),
  'c20_hidden_old_revision.xlsx': c(22, SUM27, SUM27, 0, [], 2),
  'c21_cover_only.xlsx': c(0, 0, null, 0, [], 2),
  'c22_arithmetic_errors.xlsx': c(22, SUM27, 13895775, 2, ['mismatch'], 8),
  'c23_bilingual_header_invisible_chars.xlsx': c(22, SUM27, null, 0, [], 0),
  'c24_dayworks.xlsx': c(5, 77890, null, 0, [], 0),
  'c25_empty.csv': c(0, 0, null, 0, [], 1),
  'c26_notes_inside_number_cells.xlsx': c(9, 1009575, null, 1, ['noqty'], 0),
  'c27_headerless_paste.txt': c(22, SUM27, null, 0, [], 0),
}

type ExpectedLines = [string, number | null, number | null][]
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIX, 'boq-27', 'expected.json'), 'utf8')) as Record<
  string,
  { file: string; items?: number; computed?: number; match?: boolean | null; reconciled?: string; lines?: ExpectedLines; read_error?: boolean }
>
const expectedByFile = new Map(Object.values(EXPECTED).map(e => [e.file, e]))

describe('BOQ reader — the 27 files', () => {
  it.each(Object.entries(FILES_27))('%s', async (file, want) => {
    const t0 = Date.now()
    const o = await open(path.join(FIX, 'boq-27', file))
    expect(o.items.length).toBe(want.n)
    expect(o.sum).toBeCloseTo(want.sum, 2)
    expect(o.res.grand ? o.res.grand.v : null).toBe(want.grand)
    expect(o.need).toBe(want.need)
    expect(o.reasons).toEqual(want.reasons)
    expect(o.ignored).toBe(want.ignored)
    if (file === 'c18_large.xlsx') expect(Date.now() - t0).toBeLessThan(30000)

    const exp = expectedByFile.get(file)
    if (!exp || file === 'c20_hidden_old_revision.xlsx') return
    if (exp.items != null) expect(o.items.length).toBe(exp.items)
    if (exp.computed != null) expect(o.sum).toBeCloseTo(exp.computed, 2)
    if (exp.lines) {
      expect(o.items.map(i => [i.code, i.qty, i.rate])).toEqual(exp.lines)
    }
    if (exp.reconciled) {
      const m = matchesFileTotal(o.sum, o.res.grand)
      expect(m === true ? 'proven' : m === false ? 'failed' : 'unproven').toBe(exp.reconciled)
    }
    if (exp.match !== undefined) expect(matchesFileTotal(o.sum, o.res.grand)).toBe(exp.match)
  })

  it('c19 corrupt: the file does not open', async () => {
    const file = path.join(FIX, 'boq-27', 'c19_corrupt.xlsx')
    await expect(open(file)).rejects.toThrow()
    await expect(loadBook('c19_corrupt.xlsx', bytesOf(file))).rejects.toMatchObject({ code: 'protected' })
  })

  it('c25 empty: nothing to read, reported as an empty file', async () => {
    const file = path.join(FIX, 'boq-27', 'c25_empty.csv')
    await expect(loadBook('c25_empty.csv', bytesOf(file))).rejects.toMatchObject({ code: 'empty' })
    const o = await open(file)
    expect(o.res.ignored).toEqual([{ sheet: 'CSV', kind: 'emptysheet' }])
  })

  it('c21 cover only: no items, no help to ask, not an unfilled template', async () => {
    const o = await open(path.join(FIX, 'boq-27', 'c21_cover_only.xlsx'))
    expect(o.items).toHaveLength(0)
    expect(o.res.unfilled).toBe(false)
    expect(o.res.help).toBeNull()
  })

  it('c20 hidden old revision: the hidden sheet is named and never read', async () => {
    const o = await open(path.join(FIX, 'boq-27', 'c20_hidden_old_revision.xlsx'))
    expect(o.items).toHaveLength(22)
    expect(o.res.ignored.some(r => r.kind === 'hidden')).toBe(true)
    expect(EXPECTED.c20_hidden_old_revision.items).toBe(27)
  })

  it('c22 arithmetic errors: only the two wrong lines are yellow and the file total disagrees', async () => {
    const o = await open(path.join(FIX, 'boq-27', 'c22_arithmetic_errors.xlsx'))
    expect(o.items.filter(i => needs(i).length).map(i => i.code)).toHaveLength(2)
    expect(matchesFileTotal(o.sum, o.res.grand)).toBe(false)
  })

  it('c02 UK lettered codes restart on every sheet and are not duplicates', async () => {
    const o = await open(path.join(FIX, 'boq-27', 'c02_uk_bills.xlsx'))
    expect(o.items.some(i => i.why.includes('dup'))).toBe(false)
  })

  it('c27 headerless paste is read by content and flagged as a guess', async () => {
    const o = await open(path.join(FIX, 'boq-27', 'c27_headerless_paste.txt'))
    expect(o.res.guess).toEqual([{ sheet: 'CSV', how: 'content' }])
  })

  it('c16 european numbers are detected for the whole file', async () => {
    const o = await open(path.join(FIX, 'boq-27', 'c16_european.csv'))
    expect(o.res.eu).toBe(true)
  })

  it('c15 windows-1256 and c14 utf-16 text files name their encoding', async () => {
    expect((await open(path.join(FIX, 'boq-27', 'c15_windows_arabic.csv'))).book.enc).toBe('Windows-1256')
    expect((await open(path.join(FIX, 'boq-27', 'c14_excel_unicode_text.txt'))).book.enc).toBe('UTF-16')
  })
})

const head = [['PROJECT BOQ'], [''], [''], [''], ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount', 'الوصف'], ['']]
type Cell = string | number
const div = (code: string, en: string, ar: string): Cell[] => [code, en, '', '', '', '', ar]
const item = (code: string, en: string, unit: string, q: Cell, r: Cell, ar: string, amt?: Cell): Cell[] => [
  code,
  en,
  unit,
  q,
  r,
  amt !== undefined ? amt : typeof q === 'number' && typeof r === 'number' ? q * r : '',
  ar,
]
const base = (): Cell[][] => [
  ...head,
  div('04', 'DIVISION 04 - MASONRY', 'الباب 04 - المباني'),
  div('04-01', 'Concrete Masonry Units', 'وحدات البلوك'),
  item('04-01-01', 'CMU Hollow block 200mm', 'm²', 150, 60, 'بلوك مفرغ 200مم'),
  item('04-01-02', 'CMU Hollow block 150mm', 'm²', 250, 55, 'بلوك مفرغ 150مم'),
  item('04-01-03', 'Insulated block 200mm', 'm²', 730, 95, 'بلوك معزول 200مم'),
]
const asStrings = (v: Cell[][]): Grid => v.map(r => r.map(x => (x == null ? '' : String(x))))
const bookOf = (sheets: [string, Cell[][]][], hidden: string[] = []): { book: Book; grids: Grid[] } => ({
  book: { sheets: [{ name: 'COVER' }, { name: 'SUMMARY' }, ...sheets.map(([n]) => ({ name: n, hidden: hidden.includes(n) }))] },
  grids: [[['COVER']], [['Project No', 'P-1']], ...sheets.map(([, r]) => asStrings(r))],
})

interface TemplateCase {
  id: string
  name: string
  n: number
  sum: number
  need: WhyFlag[]
  data: { book: Book; grids: Grid[] }
}
const cases: TemplateCase[] = []
const add = (id: string, name: string, n: number, sum: number, sheets: [string, Cell[][]][], hidden: string[] = [], need: WhyFlag[] = []): void => {
  cases.push({ id, name, n, sum, need, data: bookOf(sheets, hidden) })
}
add('T01', 'the template itself', 3, 92100, [['04 MASONRY', base()]])
{
  const r = base()
  r[8][3] = '150'
  add('T02', 'text quantity', 3, 92100, [['04 MASONRY', r]])
}
{
  const r = base()
  r[8][3] = '1,150'
  r[8][5] = 69000
  add('T03', 'quantity 1,150', 3, 152100, [['04 MASONRY', r]])
}
{
  const r = base()
  r[8][3] = '١٥٠'
  add('T04', 'Arabic digits', 3, 92100, [['04 MASONRY', r]])
}
{
  const r = base()
  r[8][1] = 'Door'
  add('T05', 'short description', 3, 92100, [['04 MASONRY', r]])
}
{
  const r = base()
  r.forEach((x, i) => {
    if (i >= 6) x[1] = ''
  })
  add('T06', 'Arabic only', 3, 92100, [['04 MASONRY', r]])
}
{
  const r = base()
  r[9][3] = ''
  r[9][5] = ''
  add('T07', 'provisional item without quantity', 3, 78350, [['04 MASONRY', r]], [], ['noqty'])
}
{
  const r = base()
  r.push(item('04-02', 'Lintels precast', 'm', 40, 30, 'أعتاب'))
  add('T08', 'item numbered with one dash', 4, 93300, [['04 MASONRY', r]])
}
{
  const r = base()
  r.push(item('04-02', 'Lintels precast', 'm', '', 30, 'أعتاب'))
  r.push(item('04-02-01', 'Block 100mm', 'm²', 75, 40, 'بلوك 100'))
  add('T09', '04-02 without quantity then an item', 5, 95100, [['04 MASONRY', r]], [], ['noqty'])
}
{
  const r = base()
  r[8][0] = '04.01.01'
  r[9][0] = '04.01.02'
  r[10][0] = '04.01.03'
  add('T10', 'dotted numbering', 3, 92100, [['04 MASONRY', r]])
}
{
  const r = base()
  r[9][0] = '04-01-01'
  add('T11', 'duplicate number', 3, 92100, [['04 MASONRY', r]], [], ['dup'])
}
{
  const r = base()
  r[8][5] = 999999
  add('T12', 'amount differs from qty x rate', 3, 92100, [['04 MASONRY', r]], [], ['mismatch'])
}
{
  const r = base()
  r[8][4] = 'SAR 60.00'
  add('T13', 'rate SAR 60.00', 3, 92100, [['04 MASONRY', r]])
}
{
  const r = base()
  r[8][3] = -20
  r[8][5] = -1200
  add('T14', 'negative quantity (omission)', 3, 81900, [['04 MASONRY', r]], [], ['neg'])
}
{
  const r = base()
  r[8][2] = 'N/A'
  add('T15', 'unit N/A', 3, 92100, [['04 MASONRY', r]])
}
{
  const r = base()
  r[8][3] = '150 m2'
  r[8][2] = ''
  add('T16', 'quantity with its unit', 3, 92100, [['04 MASONRY', r]])
}
{
  const r = [...head.slice(0, 3), ...base().slice(4)]
  add('T17', 'shorter header block', 3, 92100, [['04 MASONRY', r]])
}
add('T18', 'hidden sheet of an old issue', 3, 92100, [['04 MASONRY', base()], ['04 MASONRY R00', base()]], ['04 MASONRY R00'])
add('T19', 'summary under another name', 3, 92100, [['Summary Sheet', [['04', 'Masonry', '92,100']]], ['04 MASONRY', base()]])
{
  const r = [...head, div('03', 'DIVISION 03 - CONCRETE', 'الخرسانة'), div('03-01', 'Cast in place', 'خرسانة صب'), item('03-01-01', 'Reinforced concrete footings', 'm³', 500, 1200, 'خرسانة قواعد')]
  add('T20', 'concrete division', 1, 600000, [['03 CONCRETE', r]])
}
add('T21', 'Arabic sheet name', 3, 92100, [['المباني', base()]])
{
  const r = base()
  r.splice(9, 0, ['', 'including mortar and ties', '', '', '', '', 'ويشمل المونة والروابط'])
  add('T22', 'description over two lines', 3, 92100, [['04 MASONRY', r]])
}

describe('BOQ reader — the 22 template deviations', () => {
  it.each(cases.map(k => [k.id, k.name, k] as const))('%s %s', (_id, _name, k) => {
    const R = understand(k.data.book, k.data.grids)
    const T = totals(R, R.items)
    const got = Array.from(new Set(R.items.flatMap(needs))).sort()
    expect(R.items).toHaveLength(k.n)
    expect(Math.abs(T.sum - k.sum)).toBeLessThan(1)
    expect(got).toEqual(k.need.slice().sort())
  })

  it('T18 names what it left out', () => {
    const k = cases.find(x => x.id === 'T18')!
    const R = understand(k.data.book, k.data.grids)
    expect(R.ignored.map(x => (x.kind === 'hidden' || x.kind === 'nosheet' || x.kind === 'summary' || x.kind === 'emptysheet' ? `${x.sheet}:${x.kind}` : x.kind))).toEqual([
      '04 MASONRY R00:hidden',
      'COVER:nosheet',
      'SUMMARY:summary',
    ])
  })

  it('T22 joins the continuation line to its item', () => {
    const k = cases.find(x => x.id === 'T22')!
    const R = understand(k.data.book, k.data.grids)
    expect(R.items[0].desc).toBe('بلوك مفرغ 200مم ويشمل المونة والروابط')
    expect(R.items[0].cont).toBeDefined()
  })
})

const readWorkbook = (bytes: Uint8Array): { book: Book; grids: Grid[] } => {
  const wb = XL.read(Buffer.from(bytes))
  const asStr = (v: unknown): string => (v == null ? '' : typeof v === 'number' ? String(Number(v.toFixed(6))) : String(v))
  return {
    book: { sheets: wb.SheetNames.map(name => ({ name, hidden: false })) },
    grids: wb.SheetNames.map(name => (XL.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true }) as unknown[][]).map(r => r.map(asStr))),
  }
}

describe('Mdmak BOQ template', () => {
  const tpl = buildBoqTemplate()
  const A = readWorkbook(tpl)
  const RA = understand(A.book, A.grids)

  it('has the two sheets, the unit list and the amount formula', async () => {
    expect(A.book.sheets.map(s => s.name).join('|')).toBe('جدول الكميات|طريقة التعبئة')
    expect(A.book.sheets.map(s => s.name)).toEqual([BOQ_TEMPLATE_SHEET, BOQ_HOW_SHEET])
    const sheet1 = await (await unzip(tpl)).read('xl/worksheets/sheet1.xml')
    expect(sheet1).toContain('<f>IF(AND(ISNUMBER(D2),ISNUMBER(E2)),D2*E2,&quot;&quot;)</f>')
    expect(sheet1).toContain('<dataValidation type="list"')
    expect(BOQ_UNITS).toContain('مبلغ احتياطي')
    expect(BOQ_TEMPLATE_FILE).toBe('Mdmak-BOQ-Template.xlsx')
  })

  it('empty: header found but no items under it, and no help is asked', () => {
    expect(RA.items).toHaveLength(0)
    expect(RA.unfilled).toBe(true)
    expect(RA.help).toBeNull()
  })

  it('the bilingual header row is understood in full', () => {
    const S = RA.sheets.find(s => s.sheet === BOQ_TEMPLATE_SHEET)
    expect(S).toBeDefined()
    expect(['code', 'desc', 'unit', 'qty', 'rate', 'amount'].every(r => (S!.roles as string[]).includes(r))).toBe(true)
  })

  const H = ['رقم البند / Item', 'وصف البند / Description', 'الوحدة / Unit', 'الكمية / Qty', 'سعر الوحدة / Rate', 'الإجمالي / Amount', 'ملاحظات / Notes']
  const filled = writeXlsx([
    {
      name: 'جدول الكميات',
      rows: [
        H,
        ['01', 'الأعمال الخرسانية'],
        ['01-01', 'خرسانة عادية للنظافة C15', 'م³', 22, 230, 5060],
        ['01-02', 'خرسانة مسلحة للقواعد C35', 'م³', 110, 950, 104500],
        ['02', 'أعمال المباني'],
        ['02-01', 'بلوك أسمنتي مفرغ 20 سم', 'م²', 690],
        ['02-02', 'تمديدات كهربائية', 'مقطوعية', 1, 35000, 35000],
      ],
    },
    { name: 'طريقة التعبئة', rows: [['1. صف لكل بند'], ['2. عنوان القسم سطر بلا كمية']] },
  ])
  const B = readWorkbook(filled)
  const RB = understand(B.book, B.grids)
  const T = totals(RB, RB.items)

  it('filled: 4 items in two sections, each under its own section', () => {
    expect(RB.items).toHaveLength(4)
    expect(RB.titles).toHaveLength(2)
    expect(RB.items.every(x => x.title)).toBe(true)
    expect(RB.items[2].title?.text).toBe('أعمال المباني')
  })

  it('filled: total 144,560, one unpriced item, nothing yellow', () => {
    expect(Math.round(T.sum)).toBe(144560)
    expect(T.unpriced).toBe(1)
    expect(T.need).toBe(0)
  })

  it('the "how to fill" sheet is never read as items', () => {
    expect(RB.ignored.some(x => x.kind === 'nosheet' && x.sheet === 'طريقة التعبئة')).toBe(true)
    expect(RA.ignored.some(x => x.kind === 'nosheet' && x.sheet === 'طريقة التعبئة')).toBe(true)
  })

  it('the customer sample copy reads the same as the generated template', async () => {
    const o = await open(path.join(FIX, 'samples', 'Mdmak-BOQ-Template.xlsx'))
    expect(o.items).toHaveLength(0)
    expect(o.res.unfilled).toBe(true)
  })
})

describe('challenge BOQs', () => {
  const S = (f: string): string => path.join(FIX, 'samples', f)

  it.each([
    ['BOQ-3-Villa-Priced.xlsx', 48, 11, 1058260],
    ['BOQ-4-English-Bills.xlsx', 38, 16, 40000],
    ['BOQ-5-MEP-Quotation.xlsx', 24, 2, 98614],
    ['BOQ-1-Organized-Consultant.xlsx', 15, 1, 1390850],
  ])('%s: %i items, %i headings, items equal the file total %i', async (file, n, titles, total) => {
    const o = await open(S(file))
    expect(o.items).toHaveLength(n)
    expect(o.res.titles).toHaveLength(titles)
    expect(Math.round(o.sum)).toBe(total)
    expect(o.res.grand?.v).toBe(total)
    expect(matchesFileTotal(o.sum, o.res.grand)).toBe(true)
    expect(o.need).toBe(0)
    expect(totals(o.res, o.items).unpriced).toBe(0)
  })

  it('BOQ-2 messy: no prices, no total to match, exactly one yellow — the negative quantity', async () => {
    const o = await open(S('BOQ-2-Messy-Contractor.xlsx'))
    expect(o.items).toHaveLength(17)
    expect(o.sum).toBe(0)
    expect(totals(o.res, o.items).unpriced).toBe(17)
    expect(o.res.grand).toBeNull()
    expect(o.need).toBe(1)
    expect(o.reasons).toEqual(['neg'])
  })

  it('BOQ-6 (Etimad with VAT) and BOQ-7 (old Arabic CSV) read without help', async () => {
    const six = await open(S('BOQ-6-Etimad-Style-With-VAT.xlsx'))
    const seven = await open(S('BOQ-7-Old-Arabic-CSV.csv'))
    expect(six.items.length).toBeGreaterThan(0)
    expect(seven.items.length).toBeGreaterThan(0)
    expect(six.res.help).toBeNull()
    expect(seven.res.help).toBeNull()
  })
})

describe('reader primitives', () => {
  it('reads Arabic digits, European format, parentheses, percent and currency', () => {
    expect(pNum('١٢٣').v).toBe(123)
    expect(pNum('1.234,50', true).v).toBe(1234.5)
    expect(pNum('(500)').v).toBe(-500)
    expect(pNum('12%').v).toBe(0.12)
    expect(pNum('SAR 60.00').v).toBe(60)
    expect(pNum('1,150').v).toBe(1150)
    expect(pNum('1,5')).toMatchObject({ v: 1.5, comma: true })
    expect(pNum('150 m2')).toMatchObject({ v: 150, rest: 'm2' })
    expect(pNum('—')).toMatchObject({ v: null, empty: true })
    expect(digits('٠١۲')).toBe('012')
  })

  it('understands bilingual headers and normalises units', () => {
    expect(hdrRole('سعر الوحدة / Rate')).toBe('rate')
    expect(hdrRole('الكمية')).toBe('qty')
    expect(hdrRole('xyz')).toBeNull()
    expect(unitStd('L.S.')).toBe('مقطوعية')
    expect(unitStd('m3')).toBe('م³')
  })

  it('a column map chosen by the user ("help") replaces the guess', () => {
    const grids: Grid[] = [
      [
        ['a', 'b', 'c', 'd'],
        ['x1', 'حفر', '10', 'م3'],
        ['x2', 'ردم', '20', 'م3'],
      ],
    ]
    const book: Book = { sheets: [{ name: 'S' }] }
    const helped = understand(book, grids, { sheet: 0, hdr: 0, roles: ['code', 'desc', 'qty', 'unit'] })
    expect(helped.items.map(i => [i.code, i.desc, i.qty, i.unit])).toEqual([
      ['x1', 'حفر', 10, 'م³'],
      ['x2', 'ردم', 20, 'م³'],
    ])
  })

  it('a sheet it cannot read offers itself for help', () => {
    const grids: Grid[] = [
      [
        ['p', 'q'],
        ['1', '2'],
        ['3', '4'],
      ],
    ]
    const res = understand({ sheets: [{ name: 'S' }] }, grids)
    expect(res.items).toHaveLength(0)
    expect(res.help?.k).toBe(0)
  })

  it('the project layer takes the lone numeric column as an amount and asks for help', () => {
    const grids: Grid[] = [
      [
        ['01-01', 'حفر وردم', '5000'],
        ['01-02', 'خرسانة مسلحة', '12000'],
        ['01-03', 'حديد تسليح', '8000'],
      ],
    ]
    const book: Book = { sheets: [{ name: 'S' }] }
    const generic = understandGeneric(book, grids)
    expect(generic.items.map(i => i.qty)).toEqual([5000, 12000, 8000])
    const pm = understand(book, grids)
    expect(pm.items).toHaveLength(0)
    expect(pm.help?.roles).toEqual(['code', 'desc', 'amount'])
  })

  it('totals ignore removed items; yellow decisions clear a flag', () => {
    const k = cases.find(x => x.id === 'T07')!
    const R = understand(k.data.book, k.data.grids)
    const flagged = R.items.find(i => needs(i).length)!
    expect(totals(R, R.items).need).toBe(1)
    flagged.ok = ['noqty']
    expect(totals(R, R.items).need).toBe(0)
    flagged.removed = true
    expect(totals(R, R.items).n).toBe(2)
    expect(amountOf(R.items[0])).toBe(9000)
  })

  it('reconciles the items with the award value within one riyal', () => {
    expect(matchAward(1000, 1000.5).ok).toBe(true)
    const m = matchAward(900, 1000)
    expect(m.ok).toBe(false)
    expect(m.d).toBe(-100)
    expect(m.pct).toBe(10)
    expect(matchesFileTotal(5, null)).toBeNull()
  })

  it('limits: 5000 items and 10 MB', () => {
    expect(MAX_ROWS).toBe(5000)
    expect(MAX_MB).toBe(10)
  })
})

describe('opening files', () => {
  it('refuses a file over the size limit before reading it', async () => {
    await expect(loadBook('big.csv', new Uint8Array(MAX_MB * 1048576 + 1))).rejects.toMatchObject({ code: 'size' })
  })

  it('names old .xls files and unknown types', async () => {
    await expect(loadBook('a.xls', new Uint8Array(4))).rejects.toMatchObject({ code: 'xls' })
    await expect(loadBook('a.pdf', new Uint8Array(4))).rejects.toMatchObject({ code: 'type' })
    await expect(loadBook('a.xls', new Uint8Array(4))).rejects.toBeInstanceOf(BoqLoadError)
  })

  it('treats a non-zip .xlsx as damaged or protected', async () => {
    await expect(loadBook('a.xlsx', new Uint8Array(64))).rejects.toMatchObject({ code: 'protected' })
  })

  it('round-trips the writers: csv in Windows-1256 and a one-sheet workbook', async () => {
    const rows = [['الوصف', 'الكمية'], ['حفر', '5']]
    const w = readCsv(csv(rows, 'windows-1256', ';'))
    expect(w.enc).toBe('Windows-1256')
    expect(await w.load(w.sheets[0])).toEqual(rows)
    const x = writeXlsx([{ name: 'S', rows: [['a', 1, { f: 'B1*2' }]] }])
    const wb = await read('t.xlsx', x)
    expect((await wb.load(wb.sheets[0]))[0].slice(0, 2)).toEqual(['a', '1'])
  })
})
