export type RoundStatus = 'active' | 'paused' | 'archived'

export type RoundMembershipRole = 'player' | 'game_master'

export type RoundSummary = {
  id: string
  name: string
  system: string | null
  appointment: string | null
  status: RoundStatus
  created_at: string
  updated_at: string
}

export type MyRoundMembership = {
  round_id: string
  role: RoundMembershipRole
  created_at: string
  round: RoundSummary
}

export type CreateRoundInput = {
  name: string
  system: string
  description: string
  appointment: string
}

export type RoundDetails = RoundSummary & {
  description: string | null
}

export type AdminRound = RoundSummary & {
  orphaned_at: string | null
  gameMaster: RoundMemberProfile | null
}

export type AdminRoundDetails = RoundDetails & {
  orphaned_at: string | null
}

export type RoundDetailsMembership = {
  round_id: string
  role: RoundMembershipRole
  round: RoundDetails
}

export type UpdateRoundInput = {
  name: string
  system: string
  description: string
  appointment: string
  status: RoundStatus
}

export type RoundMemberProfile = {
  id: string
  username: string
  display_name: string
}

export type RecoveryCandidateProfile = RoundMemberProfile & {
  is_superadmin: boolean
  deletion_pending_at: string | null
}

export type RoundMember = {
  id: string
  round_id: string
  user_id: string
  role: RoundMembershipRole
  active_character_id: string | null
  created_at: string
  profile: RecoveryCandidateProfile
}
