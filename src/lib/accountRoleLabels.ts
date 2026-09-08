import type { Profile } from '../types/profile'

export const accountRoleLabels = {
  user: 'Kultist',
  admin: 'Kultistenführer',
  superadmin: 'Der Bewahrer',
} as const

export function getAccountRoleLabel(profile: Pick<Profile, 'role' | 'is_superadmin'>) {
  return profile.is_superadmin
    ? accountRoleLabels.superadmin
    : accountRoleLabels[profile.role]
}
