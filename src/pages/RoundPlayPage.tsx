import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import PlayModeHeader from '../components/PlayModeHeader'
import PlayMainContent from '../components/PlayMainContent'
import type { PlayTab } from '../components/PlayMainContent'
import PlayChatPanel from '../components/PlayChatPanel'
import { useRoundDetails } from '../hooks/useRoundDetails'
import { useRoundMembers } from '../hooks/useRoundMembers'
import { useFocusReconciliation } from '../hooks/useFocusReconciliation'
import { useRealtimeInvalidation } from '../hooks/useRealtimeInvalidation'
import { useRoundMessages } from '../hooks/useRoundMessages'
import { useSendRoundMessage } from '../hooks/useSendRoundMessage'
import { useRoundCharacters } from '../hooks/useRoundCharacters'
import type { RoundDetails, RoundMember } from '../types/round'

// Match the existing mobile breakpoint; CSS uses the same 48rem boundary.
const desktopQuery = '(width > 48rem)'
function subscribeViewport(onChange: () => void) {
  const media = window.matchMedia(desktopQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
const getDesktopSnapshot = () => window.matchMedia(desktopQuery).matches
const getServerSnapshot = () => false

type RoundPlayShellProps = {
  round: RoundDetails
  userId: string
  membership: RoundMember | undefined
  activeCharacter: { id: string; name: string } | undefined
  isSpeakerLoading: boolean
  chat: ReturnType<typeof useRoundMessages>
  onAccessRefresh: () => void
}

export function RoundPlayShell({ round, userId, membership, activeCharacter, isSpeakerLoading, chat, onAccessRefresh }: RoundPlayShellProps) {
  const [activeTab, setActiveTab] = useState<PlayTab>('table')
  const [desktopChatOpen, setDesktopChatOpen] = useState(true)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const chatToggleRef = useRef<HTMLButtonElement>(null)
  const isDesktop = useSyncExternalStore(subscribeViewport, getDesktopSnapshot, getServerSnapshot)
  const isChatOpen = isDesktop ? desktopChatOpen : mobileChatOpen
  const setChatOpen = isDesktop ? setDesktopChatOpen : setMobileChatOpen
  const [lastSeenSeq, setLastSeenSeq] = useState(0)
  const unreadCount = chat.messages.filter(message => message.round_seq > Math.max(lastSeenSeq, chat.initialLatestSeq ?? 0)).length
  const markRead = useCallback((seq: number) => setLastSeenSeq(previous => Math.max(previous, seq)), [])
  const isGameMaster = membership?.role === 'game_master'
  const role = membership?.role
  const [speakerChoice, setSpeakerChoice] = useState<{
    role: typeof role; mode: 'character' | 'game_master' | null
  }>({ role, mode: null })
  const choice = speakerChoice.role === role ? speakerChoice.mode : null
  const speakerMode = activeCharacter ? choice ?? 'character' : 'game_master'
  // Resolve defaults only after the scoped character read; preserve character mode
  // while A is being replaced by B. A confirmed missing character selects narration.
  if (speakerChoice.role !== role || (isGameMaster && !isSpeakerLoading && choice !== speakerMode)) {
    setSpeakerChoice({ role, mode: isSpeakerLoading ? null : speakerMode })
  }
  const expectedCharacterId = isGameMaster && speakerMode === 'game_master' ? null : activeCharacter?.id ?? null
  const composer = useSendRoundMessage(round.id, userId, expectedCharacterId, chat.reload, onAccessRefresh)
  const disabledReason = chat.accessDenied ? 'Du hast keinen Zugriff auf diesen Chat.'
    : round.locked_at ? 'Diese Runde ist gesperrt. Nachrichten können nicht gesendet werden.'
    : round.status === 'archived' ? 'Archivierte Runden können nicht mehr beschrieben werden.'
    : !membership || chat.isLoading || isSpeakerLoading ? 'Deine Schreibberechtigung wird geprüft …'
    : !isGameMaster && !activeCharacter ? 'Wähle zuerst einen aktiven Charakter.' : null

  return (
    <section className="play-page" aria-label="Spielmodus">
      <PlayModeHeader
        roundId={round.id}
        roundName={round.name}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isChatOpen={isChatOpen}
        onChatToggle={() => setChatOpen(!isChatOpen)}
        chatToggleRef={chatToggleRef}
        unreadCount={unreadCount}
      />
      {round.locked_at && (
        <p className="locked-round-notice" role="status">Diese Runde wurde administrativ gesperrt.</p>
      )}
      <div className="play-workspace" data-chat-open={isDesktop && isChatOpen}>
        <PlayMainContent activeTab={activeTab} />
        <PlayChatPanel
          isDesktop={isDesktop}
          isOpen={isChatOpen}
          chat={chat}
          composer={composer}
          disabledReason={disabledReason}
          speakerName={isGameMaster && speakerMode === 'game_master' ? 'Spielleitung' : activeCharacter?.name ?? null}
          speakerSelection={isGameMaster ? {
            mode: speakerMode,
            characterName: activeCharacter?.name,
            disabled: isSpeakerLoading,
            onChange: mode => setSpeakerChoice({ role, mode }),
          } : undefined}
          unreadCount={unreadCount}
          onRead={markRead}
          onClose={() => {
            setChatOpen(false)
            // The desktop close button disappears; return focus to its toggle.
            if (isDesktop) chatToggleRef.current?.focus()
          }}
        />
      </div>
    </section>
  )
}

function RoundPlayPage() {
  const { roundId } = useParams<{ roundId: string }>()
  const { user } = useAuth()
  const { round: loadedRound, isLoading, error, reload } = useRoundDetails(roundId, user?.id)
  const { members, isLoading: membersLoading, error: membersError, reload: reloadMembers } = useRoundMembers(roundId, user?.id)
  // Use the same early membership-loss check as RoundDetailsPage.
  const isMembershipMissing = !membersLoading && !membersError &&
    !members.some(member => member.user_id === user?.id)
  const round = isMembershipMissing ? null : loadedRound
  const membership = members.find(member => member.user_id === user?.id)
  const characterList = useRoundCharacters(
    membership?.active_character_id ? round?.id : undefined,
    `${user?.id}:${membership?.role}`,
    membership?.active_character_id ?? undefined,
  )
  const activeCharacter = characterList.characters.find(character =>
    character.id === membership?.active_character_id && character.owner_user_id === user?.id && character.round_id === round?.id)
  const chat = useRoundMessages(round?.id, user?.id)
  const reloadCharacters = characterList.reload
  const reloadMessages = chat.reload
  const reloadAccess = useCallback(() => {
    reload()
    reloadMembers()
    reloadCharacters()
    reloadMessages()
  }, [reload, reloadMembers, reloadCharacters, reloadMessages])
  const schedule = useFocusReconciliation(user?.id && roundId ? `${user.id}:${roundId}` : undefined, reloadAccess)
  // Keep access reconciliation alive while content is unavailable, just as on
  // RoundDetailsPage (for example when an existing round is unlocked again).
  const scopeKey = user?.id && roundId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roundId)
    ? `${user.id}:${roundId}`
    : undefined
  // Round/access and current speaker changes reconcile via the existing hooks.
  useRealtimeInvalidation({ scopeKey, table: 'rounds', filter: `id=eq.${roundId}`, onInvalidate: schedule })
  useRealtimeInvalidation({ scopeKey, table: 'round_memberships', filter: `round_id=eq.${roundId}`, includeInserts: true, onInvalidate: schedule })
  useRealtimeInvalidation({ scopeKey: membership?.active_character_id ? scopeKey : undefined,
    table: 'characters', filter: `id=eq.${membership?.active_character_id}`, onInvalidate: schedule })

  if (!isLoading && !error && round && user) {
    return <RoundPlayShell key={`${user.id}:${round.id}`} round={round} userId={user.id}
      membership={membership} activeCharacter={activeCharacter} isSpeakerLoading={characterList.isLoading}
      chat={chat} onAccessRefresh={reloadAccess} />
  }

  return (
    <section className="round-detail-page">
      <Link className="round-detail-back" to={roundId ? `/app/rounds/${roundId}` : '/app/rounds'}>
        ← Zur Rundenübersicht
      </Link>
      {isLoading ? (
        <p className="round-detail-state" role="status">Runde wird geladen...</p>
      ) : (
        <div className="round-detail-state" role="alert">
          <p>{error || 'Die Runde ist nicht verfügbar.'}</p>
          <button className="rounds-retry" type="button" onClick={reloadAccess}>Erneut versuchen</button>
        </div>
      )}
    </section>
  )
}

export default RoundPlayPage
