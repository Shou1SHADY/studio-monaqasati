import {
  buildStagesFromDepartments,
  nextWorkOrderNumber,
  advanceStages,
  splitByStock,
  computeMaterialCost,
  overdrawnInputs,
  effectiveOutput,
  type MfgDepartment,
  type WorkOrderStage,
  type WorkOrderInputItem,
} from "@/lib/manufacturing"

const departments: MfgDepartment[] = [
  { id: "cut", organizationId: "o", name: "القص", order: 2 },
  { id: "design", organizationId: "o", name: "التصميم", order: 1 },
  { id: "finish", organizationId: "o", name: "التشطيب", order: 3 },
]

describe("buildStagesFromDepartments", () => {
  it("orders stages by department order and starts the first one", () => {
    const stages = buildStagesFromDepartments(departments)
    expect(stages.map((s) => s.departmentName)).toEqual(["التصميم", "القص", "التشطيب"])
    expect(stages[0].status).toBe("in_progress")
    expect(stages[0].startedAt).toBeTruthy()
    expect(stages[1].status).toBe("pending")
    expect(stages[2].status).toBe("pending")
  })
})

describe("advanceStages", () => {
  const base = buildStagesFromDepartments(departments)

  it("completes the current stage and starts the next", () => {
    const { stages, currentStageIndex, completed } = advanceStages(base, 0)
    expect(stages[0].status).toBe("done")
    expect(stages[0].completedAt).toBeTruthy()
    expect(stages[1].status).toBe("in_progress")
    expect(stages[1].startedAt).toBeTruthy()
    expect(currentStageIndex).toBe(1)
    expect(completed).toBe(false)
  })

  it("marks the order complete when the last stage hands off", () => {
    const { stages, completed } = advanceStages(base, 2)
    expect(stages[2].status).toBe("done")
    expect(completed).toBe(true)
  })

  it("does not mutate the input", () => {
    const before = JSON.parse(JSON.stringify(base)) as WorkOrderStage[]
    advanceStages(base, 0)
    expect(base).toEqual(before)
  })
})

describe("nextWorkOrderNumber", () => {
  it("increments past the highest, treating missing numbers as 0", () => {
    expect(nextWorkOrderNumber([])).toBe(1)
    expect(nextWorkOrderNumber([{ orderNumber: 7 }, {}, { orderNumber: 2 }])).toBe(8)
  })
})

describe("computeMaterialCost", () => {
  const inputs: WorkOrderInputItem[] = [
    { inventoryItemId: "a", name: "خشب زان", quantity: 10, unit: "لوح", unitCost: 120 },
    { inventoryItemId: "b", name: "مفصلات", quantity: 40, unit: "قطعة", unitCost: 4.5 },
  ]

  it("sums quantity times cost", () => {
    expect(computeMaterialCost(inputs)).toEqual({ cost: 1380, allPriced: true })
  })

  it("flags unpriced inputs without inventing zeros into the total", () => {
    const { cost, allPriced } = computeMaterialCost([
      ...inputs,
      { inventoryItemId: "c", name: "غراء", quantity: 2, unit: "عبوة", unitCost: null },
    ])
    expect(cost).toBe(1380)
    expect(allPriced).toBe(false)
  })
})

describe("overdrawnInputs", () => {
  it("returns rows exceeding the source stock, including unknown items", () => {
    const rows = overdrawnInputs(
      [
        { inventoryItemId: "a", name: "x", quantity: 5, unit: "", unitCost: null },
        { inventoryItemId: "b", name: "y", quantity: 8, unit: "", unitCost: null },
        { inventoryItemId: "ghost", name: "z", quantity: 1, unit: "", unitCost: null },
      ],
      [
        { id: "a", quantity: 10 },
        { id: "b", quantity: 7 },
      ]
    )
    expect(rows.map((r) => r.inventoryItemId)).toEqual(["b", "ghost"])
  })
})

describe("effectiveOutput", () => {
  it("prefers the explicit output", () => {
    expect(effectiveOutput({ output: { name: "باب", quantity: 5, unit: "قطعة" }, items: [], title: "t" }).name).toBe("باب")
  })

  it("falls back to the first item, then to the title", () => {
    expect(effectiveOutput({ output: null, items: [{ name: "دولاب", quantity: 3, unit: "قطعة" }], title: "t" }))
      .toEqual({ name: "دولاب", quantity: 3, unit: "قطعة" })
    expect(effectiveOutput({ output: null, items: [], title: "أمر خاص" }))
      .toEqual({ name: "أمر خاص", quantity: 1, unit: "" })
  })
})

describe("splitByStock", () => {
  const inventory = [
    { name: "باب خشب", quantity: 10 },
    { name: "باب خشب", quantity: 5 },
    { name: "نافذة ألمنيوم", quantity: 2 },
  ]

  it("sends covered items to inStock (summing across warehouses) and the rest to manufacture", () => {
    const { toManufacture, inStock } = splitByStock(
      [
        { name: "باب خشب", quantity: 12, unit: "قطعة" },
        { name: "نافذة ألمنيوم", quantity: 5, unit: "قطعة" },
        { name: "درابزين", quantity: 3, unit: "متر" },
      ],
      inventory
    )
    expect(inStock.map((i) => i.name)).toEqual(["باب خشب"])
    expect(inStock[0].inStock).toBe(true)
    expect(toManufacture.map((i) => i.name)).toEqual(["نافذة ألمنيوم", "درابزين"])
  })

  it("matches names case-insensitively and trimmed", () => {
    const { inStock } = splitByStock(
      [{ name: "  Steel Beam ", quantity: 1, unit: "pc" }],
      [{ name: "steel beam", quantity: 3 }]
    )
    expect(inStock).toHaveLength(1)
  })
})
