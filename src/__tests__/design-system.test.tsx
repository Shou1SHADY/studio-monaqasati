/**
 * The shared controls (DEV-55): what Chip, IconButton, NativeSelect and the new
 * Button variants render, and a ratchet that keeps screens from hand-colouring
 * buttons or styling their own native select again.
 */

import fs from "node:fs"
import path from "node:path"
import { fireEvent, render, screen } from "@testing-library/react"
import { Eye } from "lucide-react"

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : (props: Record<string, unknown>) => React.createElement("svg", { "data-icon": String(name), "aria-hidden": props["aria-hidden"] })) })
})

import { Chip } from "@/components/module-ui/Chip"
import { IconButton } from "@/components/module-ui/IconButton"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { Button } from "@/components/ui/button"

describe("Chip", () => {
  it("announces whether it is pressed and shows its count", () => {
    const { rerender } = render(
      <Chip selected={false} count={3}>
        Due
      </Chip>,
    )
    const chip = screen.getByRole("button", { name: /Due/ })
    expect(chip).toHaveAttribute("aria-pressed", "false")
    expect(chip).toHaveAttribute("type", "button")
    expect(chip).toHaveTextContent("3")
    rerender(
      <Chip selected count={3}>
        Due
      </Chip>,
    )
    expect(screen.getByRole("button", { name: /Due/ })).toHaveAttribute("aria-pressed", "true")
  })

  it("hides the count when there is none, and passes clicks through", () => {
    const onClick = jest.fn()
    render(
      <Chip selected={false} onClick={onClick}>
        All
      </Chip>,
    )
    fireEvent.click(screen.getByRole("button", { name: "All" }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "All" }).textContent).toBe("All")
  })
})

describe("IconButton", () => {
  it("is named by its label and carries it as the tooltip", () => {
    render(<IconButton label="Show password" icon={Eye} />)
    const button = screen.getByRole("button", { name: "Show password" })
    expect(button).toHaveAttribute("title", "Show password")
    expect(button).toHaveAttribute("type", "button")
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
  })

  it("is at least 44px on a phone", () => {
    render(<IconButton label="Close" icon={Eye} />)
    expect(screen.getByRole("button", { name: "Close" }).className).toContain("h-11")
  })
})

describe("NativeSelect", () => {
  it("renders a real select that forwards its props and merges classes", () => {
    const onChange = jest.fn()
    render(
      <NativeSelect aria-label="Location" className="w-40" defaultValue="b" onChange={onChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </NativeSelect>,
    )
    const select = screen.getByLabelText("Location") as HTMLSelectElement
    expect(select.value).toBe("b")
    expect(select.className).toContain("w-40")
    expect(select.className).toContain("rounded-lg")
    fireEvent.change(select, { target: { value: "a" } })
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe("Button variants", () => {
  it.each([
    ["success", "bg-success"],
    ["primary", "bg-primary"],
    ["accent", "bg-accent"],
  ] as const)("%s carries its own colour", (variant, colour) => {
    render(<Button variant={variant}>Go</Button>)
    expect(screen.getByRole("button", { name: "Go" }).className).toContain(colour)
  })

  it("keeps readable text on the teal accent, which white would not be", () => {
    render(<Button variant="accent">Go</Button>)
    const cls = screen.getByRole("button", { name: "Go" }).className
    expect(cls).toContain("text-primary")
    expect(cls).not.toContain("text-white")
  })
})

describe("screens keep using the shared controls", () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (full.includes(path.join("src", "components", "ui")) || entry.name === "__tests__") continue
        walk(full)
      } else if (entry.name.endsWith(".tsx")) files.push(full)
    }
  }
  walk(path.join(process.cwd(), "src"))
  const read = (f: string) => fs.readFileSync(f, "utf8")
  const rel = (f: string) => path.relative(process.cwd(), f).replace(/\\/g, "/")

  it("styles native selects in one place (the dark landing form is the one exception)", () => {
    const offenders = files.filter((f) => /<select\b/.test(read(f))).map(rel).filter((f) => f !== "src/components/module-ui/NativeSelect.tsx")
    expect(offenders).toEqual(["src/components/OnboardingWizard.tsx"])
  })

  it("does not grow the number of buttons that paint their own background", () => {
    const hand = files.reduce((n, f) => n + (read(f).match(/<Button\b[^>]*className="[^"]*(?<![\w-])bg-(?:success|primary|accent)(?![\w/-])/g) ?? []).length, 0)
    expect(hand).toBeLessThanOrEqual(11)
  })
})
