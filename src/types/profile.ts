export type ProfileRole = 'user' | 'admin'

export type Profile = {
  id: string
  username: string
  display_name: string | null
  role: ProfileRole
  is_superadmin: boolean
  deletion_pending_at: string | null
  created_at: string
  updated_at: string
}
