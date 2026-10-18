/**
 * The review-day kit's supplier profiles (R1-start/supplier-profile-template.csv) read into free supplier accounts:
 * every row of the shipped template is accepted as written, and a row with a bad CR, mobile, IBAN, city or specialty
 * is refused with why — never "fixed". A missing VAT number or e-mail stays empty (the guide: "do not invent one").
 */

import fs from "fs"
import path from "path"
import { parseCsv, readR1Suppliers, specialtyCodes } from "@/lib/supplier-free/r1-import"

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")
const HEAD = "name_ar,name_en,cr_number,vat_number,city,national_address,mobile,email,iban,specialties,coverage_cities"
const row = (over: Partial<Record<string, string>> = {}) => {
  const v = { name_ar: "مؤسسة", name_en: "Est", cr_number: "1010734512", vat_number: "310457829600003", city: "الرياض", national_address: "7421 طريق الخرج", mobile: "0551234780", email: "a@b.sa", iban: "SA0380000000608010167519", specialties: "blocks", coverage_cities: "الرياض", ...over }
  return HEAD.split(",").map((k) => (String(v[k as keyof typeof v]).includes(",") ? `"${v[k as keyof typeof v]}"` : v[k as keyof typeof v])).join(",")
}

describe("parseCsv", () => {
  it("drops the BOM and keeps quoted commas, quotes and line breaks", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\n')).toEqual([["a", "b"], ["x, y", 'say "hi"\nthere']])
  })
})

describe("readR1Suppliers", () => {
  it("accepts every row of the shipped template, mapping codes to the platform's categories", () => {
    const rows = readR1Suppliers(fixture("r1-supplier-profile-template.csv"), specialtyCodes(fixture("r1-specialties-template.csv")))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.filter((r) => !r.ok)).toEqual([])
    const first = rows[0].ok ? rows[0].supplier : null
    expect(first).toMatchObject({ crNumber: "1010734512", phone: "+966551234780", iban: "SA0380000000608010167519", specializations: ["طوب وبلوك", "أسمنت وخرسانة", "حديد ومعادن", "عزل وأسقف"], coverageCities: ["الرياض", "الخرج"] })
  })
  it("keeps a missing VAT number and e-mail empty — never invented", () => {
    const [r] = readR1Suppliers([HEAD, row({ vat_number: "", email: "" })].join("\n"))
    expect(r.ok && r.supplier).toMatchObject({ vatNumber: "", email: "" })
  })
  it("refuses a row with why, and a second row with the same mobile or CR", () => {
    const rows = readR1Suppliers([HEAD, row({ cr_number: "12", mobile: "123", iban: "SA12", city: "Paris", specialties: "glass" }), row(), row({ cr_number: "1010000000" })].join("\n"))
    expect(rows[0]).toMatchObject({ ok: false, problems: expect.arrayContaining(["cr", "mobile", "iban", "city", "specialty"]) })
    expect(rows[1].ok).toBe(true)
    expect(rows[2]).toMatchObject({ ok: false, problems: ["duplicate"], detail: ["line 3"] })
  })
})
