export type ProjectStatus = 'active' | 'paused' | 'completed'

export type ProjectType = 'proj_type_infrastructure' | 'proj_type_buildings' | 'proj_type_roads' | 'proj_type_industrial' | 'proj_type_energy' | 'proj_type_other'
export type ClientType = 'proj_client_government' | 'proj_client_private' | 'proj_client_semi_government'

export type Project = {
  id: string
  name?: string
  status?: string
  rfqIds?: string[]
  location?: string
  region?: string
  budget?: number
  description?: string
  projectType?: string
  clientType?: string
  blueprintUrl?: string
  organizationId?: string
  contractorId?: string
  createdAt?: unknown
}

export type StatusFilter = 'all' | ProjectStatus

export type ProjectFormFields = {
  name: string
  description?: string
  location?: string
  region?: string
  budget?: string
  status: ProjectStatus
  projectType?: string
  clientType?: string
  blueprintUrl?: string
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
    region: form.region?.trim() || undefined,
    budget: form.budget ? Number(form.budget) : undefined,
    status: form.status,
    projectType: form.projectType || undefined,
    clientType: form.clientType || undefined,
    blueprintUrl: form.blueprintUrl || undefined,
    rfqIds: [],
  }
}

export function getProjectMetaSummary(project: Project): string {
  const parts: string[] = []
  if (project.region) parts.push(project.region)
  if (project.projectType) parts.push(project.projectType)
  if (project.clientType) parts.push(project.clientType)
  return parts.join(' · ')
}

export function hasBlueprint(project: Project): boolean {
  return typeof project.blueprintUrl === 'string' && project.blueprintUrl.length > 0
}

export function getStatusCounts(projects: Project[]): Record<ProjectStatus, number> {
  const counts: Record<ProjectStatus, number> = { active: 0, paused: 0, completed: 0 }
  for (const p of projects) {
    const s = p.status as ProjectStatus
    if (s in counts) counts[s]++
  }
  return counts
}
