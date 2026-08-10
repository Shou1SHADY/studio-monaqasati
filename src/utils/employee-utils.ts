export type EmployeeData = {
  name: string
  role: string
  salary: number | string
}

export function validateEmployee(data: EmployeeData): string[] {
  const errors: string[] = []
  if (!data.name?.trim()) errors.push("name_required")
  if (!data.role?.trim()) errors.push("role_required")
  const salary = typeof data.salary === "string" ? parseFloat(data.salary) : data.salary
  if (isNaN(salary) || salary < 0) errors.push("salary_invalid")
  if (salary > 1_000_000) errors.push("salary_too_high")
  return errors
}

export function parseSalary(value: string | number): number {
  const n = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : value
  return isNaN(n) ? 0 : Math.max(0, n)
}

export function formatSalary(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-US", {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function totalPayroll(employees: { salary: number }[]): number {
  return employees.reduce((sum, e) => sum + (e.salary || 0), 0)
}
