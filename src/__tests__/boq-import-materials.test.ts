/**
 * @jest-environment node
 *
 * Procurement «ارفع ملف إكسل» (IMP 1.3). The customer's own run (tests/Test-Results.txt over the 27 files, the samples and
 * the three new tables) must come out the same here; the matching, the specs with their units, the unit kinds, the
 * review's acts, the template and the rows the editor gets.
 */

import fs from 'fs'
import path from 'path'
import { JSDOM } from 'jsdom'
import { indexTree, unitsOf } from '@/lib/materials/tree'
import type { MaterialTreeFile } from '@/lib/materials/types'
import { loadBook } from '@/lib/boq-import'
import { buildMatcher, type MaterialMemory } from '@/lib/boq-import/materials-match'
import {
  MATERIALS_MAX_ROWS,
  MaterialsFileError,
  evaluateUnit,
  ignoredLines,
  isReady,
  isRow,
  loadMaterialsFile,
  readMaterials,
  understandMaterialsFile,
  type ImportRow,
} from '@/lib/boq-import/materials-read'
import { bringBack, chooseMaterial, chooseUnit, confirmUnit, counts, groupsOf, memoryOf, removeRow, typeQuantity } from '@/lib/boq-import/materials-review'
import { readUnit, unitIndex, unitKindOf } from '@/lib/boq-import/materials-units'
import { MATERIALS_TEMPLATE_FILE, MATERIALS_UNITS, buildMaterialsTemplate } from '@/lib/boq-import/materials-template'
import { memoryMap, rememberPick, storedMemory } from '@/lib/boq-import/materials-memory'
import { linesFromImport } from '@/lib/boq-import/materials-lines'
import { synKey } from '@/lib/boq-import/materials-text'
import { xlsx } from '@/lib/boq-import'
import { groupsFromRfq, newGroup, rfqLinesDoc } from '@/lib/procurement/rfq-editor'

Object.assign(globalThis, { DOMParser: new JSDOM('').window.DOMParser })

const FIX = path.join(__dirname, '..', 'test-utils', 'fixtures', 'boq-import')
const bytesOf = (file: string): Uint8Array => new Uint8Array(fs.readFileSync(file))
const index = indexTree((JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/data/material-tree.json'), 'utf8')) as MaterialTreeFile).roots)
const matcher = buildMatcher(index)
const node = (id: string | null) => (id ? index.byId.get(id) ?? null : null)

const pathOfFile = (name: string): string => {
  for (const dir of ['boq-27', 'materials', 'samples']) {
    const p = path.join(FIX, dir, name)
    if (fs.existsSync(p)) return p
  }
  throw new Error(`no fixture ${name}`)
}

/** The two picks the customer's prototype starts with («من اختيار سابق»). */
const seeded = (): MaterialMemory => {
  const paint = matcher.materialNamed('الدهانات الاساسية والديكور') as string
  const glue = matcher.materialNamed('غراء بلاط') as string
  const gutin = (node(paint)?.brands ?? []).find(b => /جوتن/.test(b.ar))?.ar ?? null
  return memoryMap([
    { ...(memoryOf(matcher, 'دهان جوتن فينوماستك', { outside: false, nodeId: paint, specs: [], brand: null })), brand: gutin, key: synKey('دهان جوتن فينوماستك'), at: '', by: '' },
    { ...(memoryOf(matcher, 'لاصق بلاط', { outside: false, nodeId: glue, specs: [], brand: null })), key: synKey('لاصق بلاط'), at: '', by: '' },
  ])
}

const opened = new Map<string, ReturnType<typeof loadMaterialsFile>>()
async function readFile(name: string, memory: MaterialMemory | null = seeded()) {
  if (!opened.has(name)) opened.set(name, loadMaterialsFile(name, bytesOf(pathOfFile(name))))
  const { book, grids } = await (opened.get(name) as ReturnType<typeof loadMaterialsFile>)
  return { book, grids, read: readMaterials(book, grids, matcher, memory) }
}

const summary = (rows: ImportRow[]) => ({
  ready: rows.filter(r => isRow(r) && isReady(r)).length,
  need: rows.filter(r => isRow(r) && !isReady(r)).length,
  none: rows.filter(r => r.kind === 'row' && !r.inc && !r.removed).length,
  // The customer’s «مقطوع» counts the lump sums, the provisional sums, the percentages and the deductions together.
  lump: rows.filter(r => r.kind !== 'row').length,
})

describe('the customer’s run (tests/Test-Results.txt) comes out the same', () => {
  const results = fs.readFileSync(path.join(FIX, 'materials', 'Test-Results.txt'), 'utf8')
  const LINE = /^✓\s+(\S+)\s+(?:خطأ=(\w+)\s+)?بنود (\d+)\/(\S+) · جاهزة (\d+) · تحتاج (\d+) · ليست مواد (\d+) · مقطوع (\d+) · متجاهل (\d+)( · ساعدنا)?/
  const lines = results.split('\n').flatMap(l => {
    const m = LINE.exec(l.trim())
    return m ? [{ file: m[1], error: m[2] || null, items: Number(m[3]), ready: Number(m[5]), need: Number(m[6]), none: Number(m[7]), lump: Number(m[8]), skipped: Number(m[9]), help: !!m[10] }] : []
  })

  it('has all the 36 files of the customer’s run', () => {
    expect(lines).toHaveLength(36)
  })

  it.each(lines.map(l => [l.file, l] as const))('%s', async (_name, want) => {
    const result = await readFile(want.file).catch((e: unknown) => {
      if (e instanceof MaterialsFileError) return e.code
      throw e
    })
    if (typeof result === 'string') {
      expect(result).toBe(want.error)
      return
    }
    const { read } = result
    expect(read.dataRows).toBe(want.items)
    if (want.error === 'rows') {
      expect(read.dataRows).toBeGreaterThan(MATERIALS_MAX_ROWS)
      await expect(understandMaterialsFile(want.file, bytesOf(pathOfFile(want.file)), matcher, seeded())).rejects.toMatchObject({ code: 'rows' })
      return
    }
    if (want.error) {
      await expect(understandMaterialsFile(want.file, bytesOf(pathOfFile(want.file)), matcher, seeded())).rejects.toMatchObject({ code: want.error })
      return
    }
    expect({ ...summary(read.rows), skipped: read.ignored.length }).toEqual({ ready: want.ready, need: want.need, none: want.none, lump: want.lump, skipped: want.skipped })
    expect(!read.ok && !!read.help).toBe(want.help)
  })

  it('c19 and c25 are refused as the customer’s run refused them', async () => {
    await expect(loadMaterialsFile('c19_corrupt.xlsx', bytesOf(pathOfFile('c19_corrupt.xlsx')))).rejects.toMatchObject({ code: 'protected' })
    await expect(loadMaterialsFile('c25_empty.csv', bytesOf(pathOfFile('c25_empty.csv')))).rejects.toMatchObject({ code: 'empty' })
  })

  it('adds up to the customer’s totals: 219 ready, 209 need you, 123 not in the list — 551 material lines', () => {
    const rows = lines.filter(l => !l.error)
    const sum = (f: (l: (typeof rows)[number]) => number) => rows.reduce((a, l) => a + f(l), 0)
    expect([sum(l => l.ready), sum(l => l.need), sum(l => l.none), sum(l => l.ready + l.need + l.none)]).toEqual([219, 209, 123, 551])
  })
})

describe('the three new tables (villa · English bills · plumbing & electrical quote)', () => {
  const FILES = ['BOQ-3-Villa-Priced.xlsx', 'BOQ-4-English-Bills.xlsx', 'BOQ-5-MEP-Quotation.xlsx']
  const GOLDEN: Array<[string, string, number, string, string, string, string]> = [
    ["BOQ-3", "جدول الكميات", 13, "الخرسانة الجاهزة للأساسات والبنية التحتية", "", "22", "م³"],
    ["BOQ-3", "جدول الكميات", 14, "الخرسانة الجاهزة للأساسات والبنية التحتية", "نوع الأسمنت=اسمنت مقاوم للكبريتات | أخرى=350", "110", "م³"],
    ["BOQ-3", "جدول الكميات", 15, "خرسانة جاهزة للإنشاءات", "أخرى=350", "32", "م³"],
    ["BOQ-3", "جدول الكميات", 16, "خرسانة جاهزة للإنشاءات", "أخرى=300", "165", "م³"],
    ["BOQ-3", "جدول الكميات", 17, "خرسانة جاهزة للإنشاءات", "", "11", "م³"],
    ["BOQ-3", "جدول الكميات", 18, "اسياخ حديد التسليح", "الدرجة=G60", "42", "طن"],
    ["BOQ-3", "جدول الكميات", 39, "البورسلين", "الدرجة=جودة اولى | أخرى=60×60", "460", "م²"],
    ["BOQ-3", "جدول الكميات", 40, "السيراميك", "أخرى=30×60", "280", "م²"],
    ["BOQ-3", "جدول الكميات", 46, "أبواب WPC", "أخرى=90×220", "18", "حبة"],
    ["BOQ-3", "جدول الكميات", 53, "مغاسل", "نوع الحوض=حوض بقاعدة", "7", "حبة"],
    ["BOQ-3", "جدول الكميات", 54, "كراسي الحمام", "", "6", "حبة"],
    ["BOQ-3", "جدول الكميات", 55, "الشطاف", "", "6", "حبة"],
    ["BOQ-3", "جدول الكميات", 56, "سخان المياه", "الحجم=50 لتر | نوع السخان=سخان كهربائي", "5", "حبة"],
    ["BOQ-3", "جدول الكميات", 57, "مضخة مقوية", "القدرة=1 حصان", "1", "حبة"],
    ["BOQ-3", "جدول الكميات", 63, "افياش", "أخرى=13", "90", "حبة"],
    ["BOQ-3", "جدول الكميات", 64, "مفاتيح", "", "60", "حبة"],
    ["BOQ-3", "جدول الكميات", 66, "لوحات توزيع كهربائية جهد منخفض", "عدد المخارج=24 خط", "3", "حبة"],
    ["BOQ-3", "جدول الكميات", 67, "مصابيح الإضاءة الموضعية", "أخرى=12", "140", "حبة"],
    ["BOQ-3", "جدول الكميات", 70, "مكيف سبلت", "قدرة التبريد=18,000 وحدة", "8", "حبة"],
    ["BOQ-3", "جدول الكميات", 71, "مكيف سبلت", "قدرة التبريد=24,000 وحدة", "4", "حبة"],
    ["BOQ-3", "جدول الكميات", 72, "مواسير التكييف", "الحجم=3/8 بوصة | أخرى=5/8", "120", "متر طولي"],
    ["BOQ-4", "Bill 2 - Substructure", 13, "الخرسانة الجاهزة للأساسات والبنية التحتية", "", "96", "م³"],
    ["BOQ-4", "Bill 2 - Substructure", 14, "الخرسانة الجاهزة للأساسات والبنية التحتية", "", "48", "م³"],
    ["BOQ-4", "Bill 2 - Substructure", 15, "خرسانة جاهزة للإنشاءات", "", "9", "م³"],
    ["BOQ-4", "Bill 2 - Substructure", 18, "اسياخ حديد التسليح", "المقاس=12 مم | الدرجة=G60", "6.8", "طن"],
    ["BOQ-4", "Bill 2 - Substructure", 19, "اسياخ حديد التسليح", "المقاس=16 مم | الدرجة=G60", "9.4", "طن"],
    ["BOQ-4", "Bill 2 - Substructure", 20, "اسياخ حديد التسليح", "المقاس=20 مم | الدرجة=G60", "4.2", "طن"],
    ["BOQ-4", "Bill 3 - Superstructure", 6, "خرسانة جاهزة للإنشاءات", "", "38", "م³"],
    ["BOQ-4", "Bill 3 - Superstructure", 7, "خرسانة جاهزة للإنشاءات", "", "62", "م³"],
    ["BOQ-4", "Bill 3 - Superstructure", 8, "خرسانة جاهزة للإنشاءات", "", "210", "م³"],
    ["BOQ-4", "Bill 4 - Finishes", 6, "البورسلين", "أخرى=600×600", "1050", "م²"],
    ["BOQ-4", "Bill 4 - Finishes", 7, "السيراميك", "أخرى=300×300", "140", "م²"],
    ["BOQ-4", "Bill 4 - Finishes", 12, "السيراميك", "أخرى=300×600", "260", "م²"],
    ["BOQ-4", "Bill 4 - Finishes", 20, "أبواب مقاومة للحريق", "القياس=2100×1000 مم | مقاومة الحريق=60 دقيقة", "4", "حبة"],
    ["BOQ-5", "عرض السعر", 15, "الحنفيات والخلاطات", "نوع الخلاط=خلاط حوض", "12", "حبة"],
    ["BOQ-5", "عرض السعر", 16, "سخان المياه", "الحجم=80 لتر | نوع السخان=سخان كهربائي", "6", "حبة"],
    ["BOQ-5", "عرض السعر", 26, "مفاتيح", "", "120", "حبة"],
    ["BOQ-5", "عرض السعر", 27, "افياش", "النوع=فيش مزدوج | أخرى=13", "140", "حبة"],
    ["BOQ-5", "عرض السعر", 29, "لوحات توزيع كهربائية جهد منخفض", "عدد المخارج=12 خط", "6", "حبة"],
    ["BOQ-5", "عرض السعر", 30, "تجهيزات الإضاءة", "أخرى=60×60", "90", "حبة"],
    ["BOQ-5", "عرض السعر", 31, "مصابيح الإضاءة الموضعية", "أخرى=7", "220", "حبة"],
  ]

  it('41 lines are ready of 101 (it was 5 of 106 before the head of the description led)', async () => {
    const all = await Promise.all(FILES.map(f => readFile(f)))
    const rows = all.flatMap(a => a.read.rows).filter(r => r.kind === 'row' && !r.removed)
    expect(rows.length).toBe(101)
    expect(rows.filter(r => isRow(r) && isReady(r)).length).toBe(41)
  })

  it('every automatic match and its specs were checked by eye: these 41 and no other', async () => {
    const got: Array<[string, string, number, string, string, string, string]> = []
    for (const f of FILES) {
      const { read } = await readFile(f)
      for (const r of read.rows) {
        if (!(isRow(r) && isReady(r))) continue
        const n = node(r.nodeId) as NonNullable<ReturnType<typeof node>>
        const specs = [...r.specs.map(s => `${n.specs[s.spec].ar}=${n.specs[s.spec].options[s.option].ar}`), ...r.free.map(x => `أخرى=${x}`)].join(' | ')
        got.push([f.slice(0, 5), r.sheet, r.row, n.ar, specs, r.qty, unitsOf(index, n.id)[r.u].ar])
      }
    }
    expect(got).toEqual(GOLDEN)
  })

  it('«ماسورة كهرباء» is never the water pipes and «سلك 2.5» is never a guess: both wait for the user with the closest three', async () => {
    const { read } = await readFile('BOQ-5-MEP-Quotation.xlsx')
    const conduit = read.rows.find(r => r.text.startsWith('ماسورة كهرباء')) as ImportRow
    const wire = read.rows.find(r => r.text.startsWith('سلك 2.5')) as ImportRow
    for (const r of [conduit, wire]) {
      expect(r.nodeId).toBeNull()
      expect(r.how).toBe('pick')
      expect(r.suggestions.length).toBe(3)
      expect(isReady(r)).toBe(false)
    }
    expect(wire.suggestions.map(s => node(s)?.ar)).toEqual(['سلك NYA', 'سلك THHN', 'سلك شائك'])
  })

  it('works are not materials: excavation, installation and points get no suggestion', async () => {
    const { read } = await readFile('BOQ-3-Villa-Priced.xlsx')
    const works = read.rows.filter(r => r.kind === 'row' && r.how === 'none')
    expect(works.length).toBeGreaterThanOrEqual(4)
    for (const w of works) {
      expect(w.inc).toBe(false)
      expect(w.suggestions).toEqual([])
    }
  })
})

describe('the head of the description is hard, what follows is soft', () => {
  const m = (text: string, ctx = '') => {
    const r = matcher.match(text, ctx)
    const n = node(r.nodeId)
    return { r, name: n?.ar ?? null, specs: n ? r.specs.map(s => `${n.specs[s.spec].ar}=${n.specs[s.spec].options[s.option].ar}`) : [] }
  }

  it('position, method and brackets after the head do not stop the match', () => {
    const a = m('مباني بلوك أسمنتي مفرغ مقاس 20×20×40 سم للجدران الخارجية بمونة الأسمنت والرمل 1:4')
    expect(a.name).toBe('البلك الاسمنتي')
    expect(a.specs).toEqual(['النوع=بلوك اسمنتي مفرغ', 'القياس=20×20×40 سم'])
    expect(m('Hollow concrete block 20x20x40 to external walls in cement mortar').name).toBe('البلك الاسمنتي')
    expect(m('دهان داخلي بلاستيك مطفي (جوتن فينوماستك أو ما يعادله) ثلاثة أوجه بعد المعجون').name).toBe('الدهانات الاساسية والديكور')
  })

  it('a line that only names the place is suggested, never picked: «لياسة داخلية» suggests plaster sand', () => {
    const a = m('لياسة داخلية للجدران والأسقف على طبقتين')
    expect(a.name).toBeNull()
    expect(a.r.how).toBe('pick')
    expect(a.r.suggestions.map(s => node(s)?.ar)).toContain('رمل لياسة')
  })

  it('an unclear word waits with the closest three: «بلاط» is tiles, porcelain or ceramic', () => {
    const a = m('بلاط')
    expect(a.name).toBeNull()
    expect(a.r.suggestions.map(s => node(s)?.ar).sort()).toEqual(['البلاط', 'البورسلين', 'السيراميك'].sort())
  })

  it('a bare «اسمنت» is the ordinary cement and a bare «حديد» the rebar (the common default)', () => {
    expect(m('اسمنت').name).toBe('الاسمنت العادي')
    expect(m('حديد').name).toBe('اسياخ حديد التسليح')
  })

  it('a sub-item is read with its section: «أ) قطر 12 مم» under rebar', async () => {
    const { read } = await readFile('Sample-2-BOQ-Organized.xlsx')
    const sub = read.rows.find(r => /قطر 12/.test(r.text)) as ImportRow
    expect(node(sub.nodeId)?.ar).toBe('اسياخ حديد التسليح')
    expect(sub.how).toBe('ctx')
    expect(sub.specs.map(s => node(sub.nodeId)?.specs[s.spec].options[s.option].ar)).toEqual(['12 مم'])
  })
})

describe('specs with their unit', () => {
  const specsOf = (text: string) => {
    const r = matcher.match(text, '')
    const n = node(r.nodeId)
    return { name: n?.ar ?? null, specs: n ? r.specs.map(s => `${n.specs[s.spec].ar}=${n.specs[s.spec].options[s.option].ar}`) : [], free: r.free }
  }

  it('«سماكة 3 سم» is 30 mm', () => {
    expect(specsOf('رخام للدرج سماكة 3 سم')).toEqual({ name: 'الرخام', specs: ['السمك=30 مم'], free: [] })
  })

  it('«ارتفاع 10 سم» is not a 10 mm thickness', () => {
    const a = specsOf('وزرة رخام ارتفاع 10 سم')
    expect(a.name).toBe('الرخام')
    expect(a.specs).toEqual([])
  })

  it('«200 mm» for a block is 20×20×40', () => {
    expect(specsOf('بلوك اسمنتي مفرغ 200 mm')).toMatchObject({ name: 'البلك الاسمنتي', specs: ['النوع=بلوك اسمنتي مفرغ', 'القياس=20×20×40 سم'] })
    expect(specsOf('Hollow concrete block 200 mm').specs).toContain('القياس=20×20×40 سم')
  })

  it('a bare number picks the size option of its own unit: «حديد 16 مم»; and dimensions stay ONE free spec', () => {
    expect(specsOf('حديد 16 مم')).toEqual({ name: 'اسياخ حديد التسليح', specs: ['المقاس=16 مم'], free: [] })
    expect(specsOf('بلاط بورسلين 60×60 سم').free).toEqual(['60×60'])
  })

  it('a specific wording picks a specific option: «سخان كهربائي 80 لتر», «قاطع» is not guessed', () => {
    expect(specsOf('سخان كهربائي 80 لتر')).toEqual({ name: 'سخان المياه', specs: ['الحجم=80 لتر', 'نوع السخان=سخان كهربائي'], free: [] })
  })
})

describe('the unit comes from the material’s list', () => {
  const rebar = matcher.materialNamed('اسياخ حديد التسليح') as string
  const pipes = matcher.materialNamed('الأنابيب') as string
  const rebarUnits = unitsOf(index, rebar)
  const pipeUnits = unitsOf(index, pipes)

  it('knows the kinds: kilo and ton are mass, metre and centimetre are length, m² is an area, a piece is a count', () => {
    expect(unitKindOf('كجم')).toEqual({ kind: 'mass', factor: 1 })
    expect(unitKindOf('طن')).toEqual({ kind: 'mass', factor: 1000 })
    expect(unitKindOf('سم')?.kind).toBe('len')
    expect(unitKindOf('م2')?.kind).toBe('area')
    expect(unitKindOf('nos')?.kind).toBe('cnt')
    expect(unitKindOf('كرتون')).toBeNull()
  })

  it('finds the file’s unit among the material’s whatever its spelling', () => {
    expect(rebarUnits.map(u => u.ar)).toContain('طن')
    expect(unitIndex(rebarUnits, 'Ton')).toBe(rebarUnits.findIndex(u => u.ar === 'طن'))
    expect(unitIndex(rebarUnits, 'tons')).toBeGreaterThanOrEqual(0)
    expect(unitIndex(pipeUnits, 'nos')).toBe(pipeUnits.findIndex(u => u.ar === 'حبة'))
    expect(unitIndex(pipeUnits, 'كرتون')).toBe(-1)
  })

  it('the same kind is converted with fixed arithmetic and the file’s quantity is shown: 6800 kg → 6.8 t', () => {
    const r = readUnit({ units: rebarUnits, unitRaw: 'kg', fileQty: '6800', edited: false, confirmed: false, qty: '6800' })
    expect(r).toMatchObject({ qty: '6.8', conv: { q: '6800', u: 'kg' }, ask: false, unknown: false })
    expect(rebarUnits[r.u].ar).toBe('طن')
    const cm = readUnit({ units: unitsOf(index, matcher.materialNamed('الأنابيب') as string).concat([{ ar: 'متر', en: 'm', key: 'm' }]), unitRaw: 'سم', fileQty: '250', edited: false, confirmed: false, qty: '250' })
    expect(cm).toMatchObject({ qty: '2.5', conv: { q: '250', u: 'سم' } })
  })

  it('another kind does NOT carry the number over: 350 m of pipes is never 350 pieces — the box is empty and asks «كم حبة؟»', () => {
    const r = readUnit({ units: pipeUnits, unitRaw: 'م', fileQty: '350', edited: false, confirmed: false, qty: '350' })
    expect(r).toMatchObject({ qty: '', ask: true, unknown: true, conv: null })
    expect(pipeUnits[r.u].ar).toBe('حبة')
  })

  it('on a real file: pipes in metres ask, the block in m² asks, kilos of rebar convert', async () => {
    const { read } = await readFile('BOQ-5-MEP-Quotation.xlsx')
    const ppr = read.rows.find(r => r.text.startsWith('ماسورة PPR حار')) as ImportRow
    expect(node(ppr.nodeId)?.ar).toBe('الأنابيب')
    expect(ppr).toMatchObject({ qty: '', ask: true, unitRaw: 'متر' })
    expect(isReady(ppr)).toBe(false)
    const villa = (await readFile('BOQ-3-Villa-Priced.xlsx')).read
    const block = villa.rows.find(r => r.text.startsWith('مباني بلوك أسمنتي مفرغ مقاس 20×20×40')) as ImportRow
    expect(block).toMatchObject({ qty: '', ask: true, qFile: '690' })
    const english = (await readFile('BOQ-4-English-Bills.xlsx')).read
    const bar = english.rows.find(r => /^12 mm diameter/.test(r.text)) as ImportRow
    expect(bar).toMatchObject({ qty: '6.8', conv: { q: '6800', u: 'kg' } })
    expect(isReady(bar)).toBe(true)
  })

  it('typing the number in the material’s unit settles the question, and the file’s number stays shown', async () => {
    const { read } = await readFile('BOQ-5-MEP-Quotation.xlsx')
    const at = read.rows.findIndex(r => r.text.startsWith('ماسورة PPR حار'))
    const typed = typeQuantity(read.rows, at, '٨٠')
    expect(typed[at]).toMatchObject({ qty: '80', qEdit: true, unitOk: true, ask: true, qFile: '350' })
    expect(isReady(typed[at])).toBe(true)
    expect(typed[at].why).not.toContain('unit')
  })

  it('a unit the list and the kinds do not know is confirmed with a button that states its result; there is no free unit', () => {
    const rows = [{ ...(readMaterialsRowStub()), nodeId: rebar, unitRaw: 'كرتون', qty: '12', qFile: '12', why: [] as ImportRow['why'] }]
    const evaluated = [evaluateUnit(rows[0], matcher)]
    expect(evaluated[0].why).toContain('unit')
    expect(isReady(evaluated[0])).toBe(false)
    const confirmed = confirmUnit(evaluated, 0)
    expect(isReady(confirmed[0])).toBe(true)
    const chosen = chooseUnit(evaluated, 0, 0)
    expect(unitsOf(index, rebar)[chosen[0].u]).toBeDefined()
    expect(isReady(chosen[0])).toBe(true)
  })
})

function readMaterialsRowStub(): ImportRow {
  return {
    row: 1, sheet: 'S', kind: 'row', text: 'x', name: 'x', ctx: '', unitRaw: '', qRaw: '', qty: '', qFile: '', qEdit: false, unitOk: false, inc: true, removed: false, why: [],
    nodeId: null, specs: [], free: [], brand: null, outside: false, sub: null, how: 'none', suggestions: [], ctxRow: null, u: 0, conv: null, ask: false,
  }
}

describe('nothing is dropped silently, and the review’s acts', () => {
  it('every row of Sample-3 (a messy BOQ) is a material, needs you, is not in the list, or is skipped with its reason', async () => {
    const { read } = await readFile('Sample-3-BOQ-Messy.xlsx')
    const c = counts(read.rows)
    expect(c).toMatchObject({ items: 15, ready: 9, needYou: 5, notMaterials: 1 })
    const kinds = ignoredLines(read, read.rows).map(x => x.kind)
    expect(kinds).toContain('lump')
    expect(kinds).toContain('neg')
    expect(kinds.filter(k => ['total', 'note', 'hdr2', 'title'].includes(k)).length).toBeGreaterThan(0)
  })

  it('groups the rows: needs you, ready, and the folded «not in the list»', async () => {
    const { read } = await readFile('Sample-3-BOQ-Messy.xlsx')
    const g = groupsOf(read.rows)
    expect([g.need.length, g.ready.length, g.none.length]).toEqual([5, 9, 1])
  })

  it('removing a row and bringing it back; a deduction comes back as a line to be matched', async () => {
    const { read } = await readFile('Sample-3-BOQ-Messy.xlsx')
    const at = read.rows.findIndex(r => isRow(r) && isReady(r))
    const gone = removeRow(read.rows, at)
    expect(isRow(gone[at])).toBe(false)
    expect(ignoredLines(read, gone).some(x => x.kind === 'removed' && x.at === at)).toBe(true)
    expect(isRow(bringBack(gone, at, matcher, null)[at])).toBe(true)
    const lump = read.rows.findIndex(r => r.kind === 'lump')
    const back = bringBack(read.rows, lump, matcher, null)
    expect(back[lump].kind).toBe('row')
    expect(back[lump].inc).toBe(true)
  })

  it('a row that waits is finished by picking: one of the closest three, or «not in the list» under a sub-category', async () => {
    const { read } = await readFile('BOQ-5-MEP-Quotation.xlsx')
    const at = read.rows.findIndex(r => r.text.startsWith('سلك 2.5'))
    const nyaId = matcher.materialNamed('سلك NYA') as string
    const picked = chooseMaterial(read.rows, at, { outside: false, nodeId: nyaId, specs: [], brand: null }, matcher)
    expect(node(picked[at].nodeId)?.ar).toBe('سلك NYA')
    expect(picked[at]).toMatchObject({ how: 'user', qty: '40' })
    expect(unitsOf(index, nyaId)[picked[at].u].ar).toBe('لفة')
    expect(isReady(picked[at])).toBe(true)
    const sub = index.subs.find(s => s.ar === 'الكابلات والاسلاك') ?? index.subs[0]
    const out = chooseMaterial(read.rows, at, { outside: true, sub: sub.id }, matcher)
    expect(out[at]).toMatchObject({ outside: true, sub: sub.id, nodeId: null })
    expect(isReady(out[at])).toBe(true)
  })

  it('a file needing a column the reader cannot tell is a «help us once» (Sample-5, no quantity column)', async () => {
    const { read } = await readFile('Sample-5-No-Quantity.xlsx')
    expect(read.ok).toBe(false)
    expect(read.help).not.toBeNull()
  })
})

describe('what the company remembers', () => {
  it('a pick for a text is recognised in the next file, and a second pick replaces the first', async () => {
    const nya = matcher.materialNamed('سلك NYA') as string
    const entry = memoryOf(matcher, 'سلك 2.5 ملم (لفة 100 متر)', { outside: false, nodeId: nya, specs: [], brand: null })
    const list = rememberPick([], entry, '2026-10-26T08:00:00.000Z', 'u1')
    const { book, grids } = await loadMaterialsFile('BOQ-5-MEP-Quotation.xlsx', bytesOf(pathOfFile('BOQ-5-MEP-Quotation.xlsx')))
    const next = readMaterials(book, grids, matcher, memoryMap(list))
    const wire = next.rows.find(r => r.text.startsWith('سلك 2.5')) as ImportRow
    expect(wire).toMatchObject({ how: 'mem' })
    expect(node(wire.nodeId)?.ar).toBe('سلك NYA')
    const thhn = matcher.materialNamed('سلك THHN') as string
    const again = rememberPick(list, memoryOf(matcher, 'سلك 2.5 ملم (لفة 100 متر)', { outside: false, nodeId: thhn, specs: [], brand: null }), '2026-10-27T08:00:00.000Z', 'u2')
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ nodeId: thhn, by: 'u2' })
  })

  it('remembers the values chosen by names, so a changed list does not break it', () => {
    const rebar = matcher.materialNamed('اسياخ حديد التسليح') as string
    const n = node(rebar) as NonNullable<ReturnType<typeof node>>
    const k = n.specs.findIndex(s => s.options.some(o => o.ar === '16 مم'))
    const o = n.specs[k].options.findIndex(x => x.ar === '16 مم')
    const e = memoryOf(matcher, 'حديد الأعمدة', { outside: false, nodeId: rebar, specs: [{ spec: k, option: o }], brand: null })
    expect(e.specs).toEqual([{ spec: n.specs[k].ar, option: '16 مم' }])
    const r = matcher.match('حديد الأعمدة', '', memoryMap(rememberPick([], e, 'x', 'u')))
    expect(r.how).toBe('mem')
    expect(r.specs).toEqual([{ spec: k, option: o }])
  })

  it('reads a stored list defensively and keeps only the newest 500', () => {
    expect(storedMemory(null)).toEqual([])
    expect(storedMemory([{ text: '', nodeId: 'x' }, { text: 'a', nodeId: 'n', specs: [{ spec: 1 }] }])).toEqual([expect.objectContaining({ text: 'a', nodeId: 'n', specs: [] })])
    let list = [] as ReturnType<typeof storedMemory>
    for (let i = 0; i < 520; i++) list = rememberPick(list, { text: `نص ${i}`, nodeId: 'n', specs: [], brand: null }, 'x', 'u')
    expect(list).toHaveLength(500)
    expect(list[0].text).toBe('نص 20')
  })
})

describe('the Mdmak template', () => {
  it('is the customer’s template: the same sheets, columns, units list and how-to', async () => {
    const mine = await loadBook(MATERIALS_TEMPLATE_FILE, buildMaterialsTemplate())
    const theirs = await loadBook(MATERIALS_TEMPLATE_FILE, bytesOf(path.join(FIX, 'materials', 'Mdmak-Materials-Template.xlsx')))
    expect(mine.book.sheets.map(s => s.name)).toEqual(theirs.book.sheets.map(s => s.name))
    expect(mine.grids).toEqual(theirs.grids)
    expect(MATERIALS_UNITS).toContain('كيس')
  })

  it('round trip: the empty template says «املأ المواد», a filled one is read to the last row', async () => {
    await expect(understandMaterialsFile(MATERIALS_TEMPLATE_FILE, buildMaterialsTemplate(), matcher, null)).rejects.toMatchObject({ code: 'unfilled' })
    const header = ['المادة / Material', 'المقاس أو المواصفة / Size or spec', 'الكمية / Qty', 'الوحدة / Unit', 'ملاحظة / Note']
    const filled = xlsx([
      { name: 'المواد', rtl: true, rows: [header, ['حديد تسليح', '16 مم', 12, 'طن', 'للأعمدة'], ['بلوك اسمنتي مفرغ', '20×20×40', 3000, 'حبة', ''], ['خرسانة جاهزة', 'C30', 85, 'م³', ''], ['شبك حديد', '', 40, '', '']] },
    ])
    const { read } = await understandMaterialsFile('t.xlsx', filled, matcher, null)
    expect(read.rows.map(r => [node(r.nodeId)?.ar ?? null, r.qty])).toEqual([
      ['اسياخ حديد التسليح', '12'],
      ['البلك الاسمنتي', '3000'],
      ['خرسانة جاهزة للإنشاءات', '85'],
      ['شبك حديد', '40'],
    ])
    expect(read.rows.every(r => isReady(r))).toBe(true)
  })
})

describe('the file’s limits', () => {
  it('refuses a file over 5 MB before reading it, and a table over 500 items', async () => {
    await expect(loadMaterialsFile('big.xlsx', new Uint8Array(5 * 1048576 + 1))).rejects.toMatchObject({ code: 'size' })
    await expect(understandMaterialsFile('c18_large.xlsx', bytesOf(pathOfFile('c18_large.xlsx')), matcher, null)).rejects.toMatchObject({ code: 'rows' })
  })

  it('500 different lines are understood in under two seconds (IMP-11)', async () => {
    const mats = index.materials
    const rows: Array<Array<string | number>> = [['الوصف', 'الوحدة', 'الكمية']]
    for (let i = 0; i < 500; i++) {
      const m = mats[i % mats.length]
      const spec = m.specs[0]?.options[i % (m.specs[0]?.options.length || 1)]
      rows.push([`${m.ar} ${spec?.ar ?? ''} للجدران الخارجية رقم ${i}`, m.units[0]?.ar ?? 'حبة', 10 + i])
    }
    const { book, grids } = await loadMaterialsFile('speed.xlsx', xlsx([{ name: 'S', rtl: true, rows }]))
    const t0 = Date.now()
    const read = readMaterials(book, grids, buildMatcher(index), null)
    expect(read.rows).toHaveLength(500)
    expect(Date.now() - t0).toBeLessThan(6000)
  })
})

describe('what reaches the editor', () => {
  const ctx = { index, locale: 'ar', file: 'ملف.xlsx', multiSheet: false }

  it('an imported row is exactly the row the editor makes: the material, its spec cells, the quantity and the unit from the material', async () => {
    const { read } = await readFile('Sample-1-Template-Filled.xlsx')
    const lines = linesFromImport(read.rows, ctx)
    const rebar = lines[0]
    expect(rebar.material?.path.map(p => p.ar)).toEqual(['الحديد', 'حديد التسليح', 'اسياخ حديد التسليح'])
    expect(rebar.material?.specs.map(s => [s.name.ar, s.value.ar])).toEqual([['المقاس', '16 مم']])
    expect(rebar).toMatchObject({ name: 'اسياخ حديد التسليح', quantity: '12', unit: 'طن', unitFromSource: false })
    expect(rebar.imported).toMatchObject({ file: 'ملف.xlsx', sheet: null, row: 2, hint: null })
    expect(lines.filter(l => !l.material)).toHaveLength(0)
    const asks = lines.filter(l => !(Number(l.quantity) > 0))
    expect(asks.map(l => [l.name, l.imported?.hint])).toEqual([['رمل لياسة', { quantity: '30', unit: 'كيس', converted: false }]])
  })

  it('a row that needs a material arrives with its words and the file’s unit, and says what the file said when the unit is not the material’s', async () => {
    const { read } = await readFile('BOQ-5-MEP-Quotation.xlsx')
    const lines = linesFromImport(read.rows, { ...ctx, multiSheet: true })
    const wire = lines.find(l => l.imported?.text?.startsWith('سلك 2.5')) as (typeof lines)[number]
    expect(wire.material).toBeNull()
    expect(wire).toMatchObject({ unit: 'لفة', unitFromSource: true, quantity: '40' })
    const pipe = lines.find(l => l.imported?.text?.startsWith('ماسورة PPR حار')) as (typeof lines)[number]
    expect(pipe).toMatchObject({ quantity: '', unit: 'حبة' })
    expect(pipe.imported?.hint).toEqual({ quantity: '350', unit: 'متر', converted: false })
    expect(pipe.imported?.sheet).toBe('عرض السعر')
    const eng = linesFromImport((await readFile('BOQ-4-English-Bills.xlsx')).read.rows, ctx).find(l => l.imported?.text?.startsWith('12 mm diameter')) as (typeof lines)[number]
    expect(eng).toMatchObject({ quantity: '6.8', unit: 'طن' })
    expect(eng.imported?.hint).toEqual({ quantity: '6800', unit: 'kg', converted: true })
  })

  it('what the user removed is not added, and the source travels with the RFQ and comes back with the draft', async () => {
    const { read } = await readFile('Sample-1-Template-Filled.xlsx')
    const rows = removeRow(read.rows, 0)
    const lines = linesFromImport(rows, ctx)
    expect(lines).toHaveLength(read.rows.filter(isRow).length - 1)
    const group = newGroup({ city: 'الرياض', lines })
    const doc = rfqLinesDoc([group], 'ar', () => null, { draft: true })
    expect(doc.products[0]).toMatchObject({ importedFrom: { file: 'ملف.xlsx', sheet: null, row: 3 } })
    const back = groupsFromRfq({ products: doc.products, editorGroups: [] })
    expect(back[0].lines[0].imported).toEqual({ file: 'ملف.xlsx', sheet: null, row: 3 })
  })

  it('a material outside the list keeps its sub-category and its words', async () => {
    const { read } = await readFile('BOQ-5-MEP-Quotation.xlsx')
    const at = read.rows.findIndex(r => r.text.startsWith('علب كهرباء'))
    const sub = index.subs[0]
    const rows = chooseMaterial(read.rows, at, { outside: true, sub: sub.id }, matcher)
    const line = linesFromImport(rows, ctx).find(l => l.imported?.row === rows[at].row) as ReturnType<typeof linesFromImport>[number]
    expect(line.material).toMatchObject({ outside: true, subId: sub.id })
    expect(line).toMatchObject({ name: rows[at].name, unit: 'حبة' })
  })
})
