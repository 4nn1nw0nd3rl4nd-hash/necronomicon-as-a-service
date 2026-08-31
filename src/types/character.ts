export type CharacterSummary = {
  id: string
  name: string
  owner_user_id: string | null
  round_id: string | null
  template_key: string
  template_version: number
  created_at: string
  updated_at: string
}

export type CharacterDetails = CharacterSummary & {
  data: Record<string, unknown>
  created_by_user_id: string | null
  deleted_at: string | null
}
