export type ProjectStatus = 'active' | 'paused' | 'completed'

export type Project = {
  id: string
  name?: string
  status?: string
  rfqIds?: string[]
  location?: string
  budget?: number
  description?: string
  organizationId?: string
  contractorId?: string
  createdAt?: unknown
}

export type StatusFilter = 'all' | ProjectStatus

export type ProjectFormFields = {
  name: string
  description?: string
  location?: string
  budget?: string
  status: ProjectStatus
}

export type ValidationResult = {
  isValid: boolean
  errors: string[]
}

export function filterProjectsByStatus(projects: Project[], filter: StatusFilter): Project[] {
  if (filter === 'all') return projects
  return projects.filter(p => p.status === filter)
}

export function getProjectRfqCount(project: Project): number {
  return project.rfqIds?.length ?? 0
}

export function validateProjectForm(form: ProjectFormFields): ValidationResult {
  const errors: string[] = []
  if (!form.name.trim()) {
    errors.push('اسم المشروع مطلوب')
  }
  return { isValid: errors.length === 0, errors }
}

export function buildProjectData(
  form: ProjectFormFields,
  userId: string,
  orgId: string
): Omit<Project, 'id'> & { contractorId: string; organizationId: string; rfqIds: string[] } {
  return {
    organizationId: orgId,
    contractorId: userId,
    name: form.name.trim(),
    description: form.description?.trim() || undefined,
    location: form.location?.trim() || undefined,
    budget: form.budget ? Number(form.budget) : undefined,
    status: form.status,
    rfqIds: [],
  }
}

export function getStatusCounts(projects: Project[]): Record<ProjectStatus, number> {
  const counts: Record<ProjectStatus, number> = { active: 0, paused: 0, completed: 0 }
  for (const p of projects) {
    const s = p.status as ProjectStatus
    if (s in counts) counts[s]++
  }
  return counts
}
