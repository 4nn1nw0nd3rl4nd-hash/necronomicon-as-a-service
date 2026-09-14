export const ROUND_MESSAGE_MAX_LENGTH = 4000
export const ROUND_MESSAGE_PAGE_SIZE = 50

export type RoundMessage = {
  id: string
  round_id: string
  round_seq: number
  author_user_id: string | null
  character_id: string | null
  speaker_kind: 'character' | 'game_master'
  speaker_name_snapshot: string
  kind: 'character_message'
  body: string
  client_request_id: string
  created_at: string
}

export const roundMessageFields = 'id,round_id,round_seq,author_user_id,character_id,speaker_kind,speaker_name_snapshot,kind,body,client_request_id,created_at'

export function isValidMessageBody(body: string) {
  return body.trim().length > 0 && Array.from(body).length <= ROUND_MESSAGE_MAX_LENGTH
}
