/**
 * PM 1.0 — the R1 BOQ template (Delivery-PM-1.0/R1-start/boq-template.csv,
 * CON-01). The acceptance wizard handed a .csv to the legacy tender parser,
 * which expects six header rows and reads cells as dates: of the template's
 * ten lines it imported two, with a date for a division, no Arabic description
 * and no unit cost — and said "loaded 2". A CSV is read as the template is
 * written: one header row, then code · description · unit · qty · rate · unit_cost.
 */
import { parseBoqCsv } from "@/lib/pm/boq"

// The template exactly as delivered (BOM, CRLF, an unpriced line).
const TEMPLATE =
  "﻿code,description,unit,qty,rate,unit_cost\r\n" +
  "02-01-01,حفر عام للأساسات حتى المنسوب التصميمي,م3,850,28,21\r\n" +
  "03-01-01,خرسانة عادية للنظافة تحت القواعد,م3,60,290,240\r\n" +
  "03-02-01,خرسانة مسلحة للقواعد والميد,م3,180,1150,960\r\n" +
  "03-05-01,حديد تسليح مورّد ومركّب,طن,96,3350,2890\r\n" +
  "04-01-01,بلوك إسمنتي معزول 20 سم,م2,2400,58,47\r\n" +
  "04-02-01,لياسة داخلية وخارجية,م2,5200,32,25\r\n" +
  "09-01-01,بلاط بورسلين للأرضيات,م2,1450,118,92\r\n" +
  "09-02-01,وزرات,م.ط,900,,\r\n" +
  "15-01-01,أعمال السباكة والصرف الداخلي,مقطوعية,1,185000,158000\r\n" +
  "16-01-01,التمديدات الكهربائية والإنارة,مقطوعية,1,240000,205000\r\n"

describe("the R1 BOQ template", () => {
  const { ok, bad } = parseBoqCsv(TEMPLATE)

  it("every one of its ten lines is read, none rejected", () => {
    expect(bad).toEqual([])
    expect(ok.map((r) => r.code)).toEqual(["02-01-01", "03-01-01", "03-02-01", "03-05-01", "04-01-01", "04-02-01", "09-01-01", "09-02-01", "15-01-01", "16-01-01"])
  })

  it("codes stay codes, descriptions stay Arabic, the unit cost is kept, and the total is the contract's", () => {
    expect(ok[5]).toMatchObject({ code: "04-02-01", description: "لياسة داخلية وخارجية", unit: "م2", quantity: 5200, rate: 32, cost: 25 })
    expect(ok.reduce((a, r) => a + r.quantity * (r.rate ?? 0), 0)).toBe(1_471_500)
  })

  it("an unpriced line is read as unpriced — never given a rate or a quantity it does not have (CON-02)", () => {
    expect(ok[7]).toMatchObject({ code: "09-02-01", quantity: 900, rate: null, cost: null })
  })

  it("its line numbers are the file's", () => {
    expect(ok[0].line).toBe(2)
    expect(ok[9].line).toBe(11)
  })
})

describe("a CSV as people send it", () => {
  it("quoted cells with commas, thousands separators and a semicolon-separated file", () => {
    const r = parseBoqCsv('code,description,unit,qty,rate,unit_cost\n03-01,"Concrete, grade 30",m3,"1,250",290,240\n')
    expect(r.ok[0]).toMatchObject({ code: "03-01", description: "Concrete, grade 30", quantity: 1250, rate: 290 })
    const semi = parseBoqCsv("code;description;unit;qty;rate;unit_cost\n03-01;Concrete;m3;10;290;240\n")
    expect(semi.ok[0]).toMatchObject({ code: "03-01", quantity: 10, rate: 290, cost: 240 })
  })

  it("columns are found by their header, in any order; a file with no header is read in the template's order", () => {
    const r = parseBoqCsv("qty,code,rate,description,unit\n10,03-01,290,Concrete,m3\n")
    expect(r.ok[0]).toMatchObject({ code: "03-01", description: "Concrete", unit: "m3", quantity: 10, rate: 290, cost: null })
    expect(parseBoqCsv("03-01,Concrete,m3,10,290,240\n").ok[0]).toMatchObject({ code: "03-01", quantity: 10, line: 1 })
  })

  it("a bad line is named with its reason and its line — never dropped, never invented", () => {
    const r = parseBoqCsv("code,description,unit,qty,rate,unit_cost\n03-01,Concrete,m3,10,290,240\n03-01,Again,m3,5,1,1\nx,No code,m3,,1,1\n")
    expect(r.ok).toHaveLength(1)
    expect(r.bad.map((b) => [b.line, b.problems])).toEqual([[3, ["duplicate"]], [4, ["code_format", "bad_qty"]]])
  })
})
