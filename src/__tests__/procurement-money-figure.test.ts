import { figure, moneyFigure } from "@/components/procurement/PoModel"

describe("moneyFigure — an amount shows both halala digits or none (UAT: VAT read '2,392.5')", () => {
  it("keeps whole riyals bare", () => {
    expect(moneyFigure(36200)).toBe("36,200")
  })
  it("never drops a trailing halala digit", () => {
    expect(moneyFigure(2392.5)).toBe("2,392.50")
    expect(moneyFigure(18342.5)).toBe("18,342.50")
    expect(moneyFigure(0.07)).toBe("0.07")
  })
  it("treats nothing as zero", () => {
    expect(moneyFigure(null)).toBe("0")
  })
  it("leaves quantities to figure, which does not pad", () => {
    expect(figure(5)).toBe("5")
    expect(figure(2.5)).toBe("2.5")
  })
})
