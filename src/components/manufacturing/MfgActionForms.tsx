"use client"

// Every decision a work order takes is one form (PRD section 4). This file
// only routes an `OrderAction` to its form; each form states the order it
// acts on, the facts it rests on, whether it will go through — before the
// click — and records the decision in the signed-in user's name.

import { useMfgUi, type OrderAction } from "./MfgUiContext"
import { GateForm, ReleaseForm, RushForm, SlabForm, SubmitDrawingForm, SurveyForm } from "./MfgFormRelease"
import { ConfirmReceiptForm, OverrideForm, PurchaseForm, RequestMaterialsForm } from "./MfgFormMaterials"
import { OutputForm, QcForm } from "./MfgFormOutput"
import { ClarifyScrapForm, RemakeForm, ReviewScrapForm } from "./MfgFormScrap"
import { ChangeForm, CloseForm, DeliverForm, VarianceForm } from "./MfgFormClose"

export function MfgActionForms({ orderId, action, onClose }: { orderId: string; action: OrderAction; onClose: () => void }) {
  const ui = useMfgUi()
  const view = ui.viewById.get(orderId)
  if (!view) return null
  switch (action.kind) {
    case "survey":
      return <SurveyForm view={view} onClose={onClose} />
    case "release":
      return <ReleaseForm view={view} onClose={onClose} />
    case "rush":
      return <RushForm view={view} onClose={onClose} />
    case "submitDrawing":
      return <SubmitDrawingForm view={view} onClose={onClose} />
    case "slab":
      return <SlabForm view={view} onClose={onClose} />
    case "gate":
      return <GateForm view={view} index={action.index} onClose={onClose} />
    case "requestMaterials":
      return <RequestMaterialsForm view={view} departmentId={action.departmentId} onClose={onClose} />
    case "confirmReceipt":
      return <ConfirmReceiptForm view={view} departmentId={action.departmentId} requestNumber={action.requestNumber} onClose={onClose} />
    case "output":
      return <OutputForm view={view} index={action.index} onClose={onClose} />
    case "qc":
      return <QcForm view={view} index={action.index} onClose={onClose} />
    case "reviewScrap":
      return <ReviewScrapForm view={view} scrapId={action.scrapId} onClose={onClose} />
    case "clarifyScrap":
      return <ClarifyScrapForm view={view} scrapId={action.scrapId} onClose={onClose} />
    case "remake":
      return <RemakeForm view={view} source={action.source} onClose={onClose} />
    case "close":
      return <CloseForm view={view} onClose={onClose} />
    case "deliver":
      return <DeliverForm view={view} onClose={onClose} />
    case "purchase":
      return <PurchaseForm view={view} itemName={action.itemName} onClose={onClose} />
    case "override":
      return <OverrideForm view={view} index={action.index} onClose={onClose} />
    case "change":
      return <ChangeForm view={view} onClose={onClose} />
    case "variance":
      return <VarianceForm view={view} departmentId={action.departmentId} onClose={onClose} />
  }
}
