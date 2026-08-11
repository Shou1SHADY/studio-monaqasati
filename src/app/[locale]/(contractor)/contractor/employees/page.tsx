"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { Briefcase, Plus, Pencil, Trash2, Loader2, Users2, Wallet } from "lucide-react"
import { validateEmployee, formatSalary, parseSalary, totalPayroll } from "@/utils/employee-utils"

type Employee = {
  id: string
  name: string
  role: string
  salary: number
  organizationId: string
}

function EmployeeDialog({
  open,
  onOpenChange,
  employee,
  orgId,
  t,
  locale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employee?: Employee
  orgId: string
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [name, setName] = useState(employee?.name ?? "")
  const [role, setRole] = useState(employee?.role ?? "")
  const [salary, setSalary] = useState(employee?.salary?.toString() ?? "")

  const reset = () => {
    setName(employee?.name ?? "")
    setRole(employee?.role ?? "")
    setSalary(employee?.salary?.toString() ?? "")
  }

  const handleSave = async () => {
    if (!firestore) return
    const errors = validateEmployee({ name, role, salary })
    if (errors.length > 0) {
      toast({ title: t("emp_validation_error"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const data = {
        name: name.trim(),
        role: role.trim(),
        salary: parseSalary(salary),
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      if (employee) {
        await updateDoc(doc(firestore, "employees", employee.id), data)
        toast({ title: t("emp_updated") })
      } else {
        await addDoc(collection(firestore, "employees"), { ...data, createdAt: serverTimestamp() })
        toast({ title: t("emp_added") })
      }
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("emp_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) { onOpenChange(next); if (!next) reset() } }}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle>{employee ? t("emp_edit_title") : t("emp_add_title")}</DialogTitle>
          <DialogDescription>{t("emp_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="emp-name">{t("emp_name")} *</Label>
            <Input id="emp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("emp_name_placeholder")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-role">{t("emp_role")} *</Label>
            <Input id="emp-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder={t("emp_role_placeholder")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-salary">{t("emp_salary")} *</Label>
            <Input
              id="emp-salary"
              type="number"
              min="0"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              placeholder={t("emp_salary_placeholder")}
              dir="ltr"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>{t("emp_cancel")}</Button>
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : null}
            {t("emp_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function ContractorEmployeesPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManageEmployees = can("employees.manage")

  const [showAdd, setShowAdd] = useState(false)
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null)
  const [deleteEmployee, setDeleteEmployee] = useState<Employee | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const myOrgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""

  const employeesQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(collection(firestore, "employees"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId])
  const { data: employees, isLoading } = useCollection(employeesQuery)
  const list = (employees || []) as Employee[]

  const handleDelete = async () => {
    if (!firestore || !deleteEmployee) return
    setIsDeleting(true)
    try {
      await deleteDoc(doc(firestore, "employees", deleteEmployee.id))
      toast({ title: t("emp_deleted") })
      setDeleteEmployee(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("emp_delete_error"), variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const payroll = totalPayroll(list)

  return (
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-primary flex items-center gap-2">
              <Briefcase size={22} />
              {t("emp_page_title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t("emp_page_desc")}</p>
          </div>
          {canManageEmployees && (
            <Button onClick={() => setShowAdd(true)} className="gap-2 shrink-0">
              <Plus size={16} />
              {t("emp_add_btn")}
            </Button>
          )}
        </div>

        {/* Payroll summary */}
        {list.length > 0 && (
          <Card className="border-accent/20 bg-accent/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                <Wallet size={18} className="text-accent" />
              </div>
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase">{t("emp_total_payroll")}</p>
                <p className="text-lg font-black text-primary" dir="ltr">{formatSalary(payroll, locale)}</p>
              </div>
              <div className="ms-auto text-right">
                <p className="text-xs text-muted-foreground">{t("emp_total_count")}</p>
                <p className="font-bold text-primary">{list.length}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Employee list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Users2 size={48} className="text-muted-foreground/20" />
            <p className="font-bold text-muted-foreground">{t("emp_empty_title")}</p>
            <p className="text-sm text-muted-foreground/70">{t("emp_empty_desc")}</p>
            {canManageEmployees && (
              <Button onClick={() => setShowAdd(true)} variant="outline" className="gap-2 mt-2">
                <Plus size={14} />
                {t("emp_add_btn")}
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b">
                <tr>
                  <th className={`py-3 px-4 font-bold text-muted-foreground ${isRtl ? "text-right" : "text-left"}`}>{t("emp_name")}</th>
                  <th className={`py-3 px-4 font-bold text-muted-foreground ${isRtl ? "text-right" : "text-left"}`}>{t("emp_role")}</th>
                  <th className={`py-3 px-4 font-bold text-muted-foreground ${isRtl ? "text-right" : "text-left"}`}>{t("emp_salary")}</th>
                  <th className="py-3 px-4 w-20" />
                </tr>
              </thead>
              <tbody>
                {list.map((emp, idx) => (
                  <tr key={emp.id} className={idx % 2 === 0 ? "bg-white" : "bg-muted/10"}>
                    <td className="py-3 px-4 font-semibold text-primary">{emp.name}</td>
                    <td className="py-3 px-4 text-muted-foreground">{emp.role}</td>
                    <td className="py-3 px-4 font-mono text-sm" dir="ltr">{formatSalary(emp.salary, locale)}</td>
                    <td className="py-3 px-4">
                      {canManageEmployees && (
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            onClick={() => setEditEmployee(emp)}
                            aria-label={t("emp_edit_title")}
                          >
                            <Pencil size={13} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteEmployee(emp)}
                            aria-label={t("emp_delete_btn")}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add dialog */}
      <EmployeeDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        orgId={myOrgId}
        t={t}
        locale={locale}
      />

      {/* Edit dialog */}
      {editEmployee && (
        <EmployeeDialog
          open={!!editEmployee}
          onOpenChange={(open) => { if (!open) setEditEmployee(null) }}
          employee={editEmployee}
          orgId={myOrgId}
          t={t}
          locale={locale}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteEmployee} onOpenChange={(open) => { if (!open) setDeleteEmployee(null) }}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("emp_delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("emp_delete_confirm_desc", { name: deleteEmployee?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("emp_cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90 gap-2"
            >
              {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {t("emp_delete_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  )
}
