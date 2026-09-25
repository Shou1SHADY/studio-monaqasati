/**
 * The shared module UI (PM 1.0 prototype patterns on our tokens): what each
 * piece renders, what it hides, and that it never carries text of its own.
 */

import { fireEvent, render, screen } from "@testing-library/react"
import { AlertTriangle, FolderKanban } from "lucide-react"

jest.mock("lucide-react", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  return new Proxy({}, { get: (_t, name) => (name === "__esModule" ? false : () => React.createElement("svg", { "data-icon": String(name) })) })
})

jest.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { ModuleHeader } from "@/components/module-ui/ModuleHeader"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { WizardSteps } from "@/components/module-ui/WizardSteps"

describe("SegmentedNav", () => {
  const segs = [
    { id: "boq", label: "BOQ" },
    { id: "terms", label: "Terms", count: 2, tone: "bad" as const },
    { id: "vo", label: "Variations", count: 0 },
  ]
  it("selects on click, marks the active one, and hides zero counts", () => {
    const onSelect = jest.fn()
    render(<SegmentedNav segments={segs} active="boq" onSelect={onSelect} ariaLabel="Contract" />)
    expect(screen.getByRole("tab", { name: "BOQ" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: /Terms/ })).toHaveTextContent("2")
    expect(screen.getByRole("tab", { name: "Variations" })).not.toHaveTextContent("0")
    fireEvent.click(screen.getByRole("tab", { name: /Terms/ }))
    expect(onSelect).toHaveBeenCalledWith("terms")
  })
  it("renders nothing for a single segment — no bar for one choice", () => {
    const { container } = render(<SegmentedNav segments={[segs[0]]} active="boq" onSelect={() => {}} ariaLabel="x" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("ModuleHeader", () => {
  it("shows the title, status, KPIs and tabs with urgent counts, the active tab marked", () => {
    render(
      <ModuleHeader
        icon={FolderKanban}
        title="Riyadh Tower"
        status={<StatusPill tone="ok">Live</StatusPill>}
        crumbs={[{ label: "Projects", href: "/contractor/projects" }, { label: "Riyadh Tower" }]}
        kpis={[{ id: "p", label: "Progress", value: "42%" }]}
        kpisLabel="Key figures"
        tabs={[
          { id: "pulse", label: "Pulse", href: "/p" },
          { id: "contract", label: "Contract", href: "/c", count: 3, urgent: true },
        ]}
        activeTab="contract"
        tabsLabel="Project"
      />
    )
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Riyadh Tower")
    expect(screen.getByText("Live")).toBeInTheDocument()
    expect(screen.getByText("42%")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Contract/ })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: /Contract/ })).toHaveTextContent("3")
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/contractor/projects")
  })
})

describe("the small pieces", () => {
  it("DecisionRow carries its severity, age and amount", () => {
    render(
      <ul>
        <DecisionRow severity="red" icon={AlertTriangle} title="Executed on unpriced items" detail="3 items" age="4 days" amount="SAR 141,600" />
      </ul>
    )
    expect(screen.getByText("Executed on unpriced items")).toBeInTheDocument()
    expect(screen.getByText("4 days")).toBeInTheDocument()
    expect(screen.getByText("SAR 141,600")).toBeInTheDocument()
  })
  it("BlockingReasons lists every reason, and renders nothing when there is none", () => {
    const { rerender, container } = render(<BlockingReasons title="Cannot save" reasons={["Client response is required", "Granted days are required"]} />)
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    rerender(<BlockingReasons title="Cannot save" reasons={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
  it("a blocking callout is announced as an alert; an info one as a note", () => {
    const { rerender } = render(<Callout tone="block">No</Callout>)
    expect(screen.getByRole("alert")).toHaveTextContent("No")
    rerender(<Callout tone="info">Yes</Callout>)
    expect(screen.getByRole("note")).toHaveTextContent("Yes")
  })
  it("WizardSteps marks the current step", () => {
    render(<WizardSteps steps={["Project", "Sections", "BOQ"]} current={1} ariaLabel="Steps" />)
    expect(screen.getByText("Sections").closest("li")).toHaveAttribute("aria-current", "step")
  })
  it("SourceBadge takes the module's colour from the registry — Projects is now the PM blue", () => {
    render(<SourceBadge module="project-management" label="Projects" />)
    expect(screen.getByText("Projects").className).toContain("text-pm")
    render(<SourceBadge module="procurement" label="Procurement" />)
    expect(screen.getByText("Procurement").className).toContain("text-cta")
  })
  it("EmptyState shows what would be here", () => {
    render(<EmptyState icon={FolderKanban} title="No projects yet" description="Accept a handover to start" />)
    expect(screen.getByText("No projects yet")).toBeInTheDocument()
  })
})
