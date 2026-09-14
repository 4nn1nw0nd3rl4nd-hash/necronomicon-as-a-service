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
import type { RoundDetails } from '../types/round'

// Match the existing mobile breakpoint; CSS uses the same 48rem boundary.
const desktopQuery = '(width > 48rem)'
function subscribeViewport(onChange: () => void) {
  const media = window.matchMedia(desktopQuery)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
const getDesktopSnapshot = () => window.matchMedia(desktopQuery).matches
const getServerSnapshot = () => false

export function RoundPlayShell({ round }: { round: RoundDetails }) {
  const [activeTab, setActiveTab] = useState<PlayTab>('table')
  const [desktopChatOpen, setDesktopChatOpen] = useState(true)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const chatToggleRef = useRef<HTMLButtonElement>(null)
  const isDesktop = useSyncExternalStore(subscribeViewport, getDesktopSnapshot, getServerSnapshot)
  const isChatOpen = isDesktop ? desktopChatOpen : mobileChatOpen
  const setChatOpen = isDesktop ? setDesktopChatOpen : setMobileChatOpen

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
      />
      {round.locked_at && (
        <p className="locked-round-notice" role="status">Diese Runde wurde administrativ gesperrt.</p>
      )}
      <div className="play-workspace" data-chat-open={isDesktop && isChatOpen}>
        <PlayMainContent activeTab={activeTab} />
        <PlayChatPanel
          isDesktop={isDesktop}
          isOpen={isChatOpen}
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
  const reloadAccess = useCallback(() => {
    reload()
    reloadMembers()
  }, [reload, reloadMembers])
  const schedule = useFocusReconciliation(user?.id && roundId ? `${user.id}:${roundId}` : undefined, reloadAccess)
  // Keep access reconciliation alive while content is unavailable, just as on
  // RoundDetailsPage (for example when an existing round is unlocked again).
  const scopeKey = user?.id && roundId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roundId)
    ? `${user.id}:${roundId}`
    : undefined
  // Only existing round/access invalidation, with no chat or character data.
  useRealtimeInvalidation({ scopeKey, table: 'rounds', filter: `id=eq.${roundId}`, onInvalidate: schedule })
  useRealtimeInvalidation({ scopeKey, table: 'round_memberships', filter: `round_id=eq.${roundId}`, includeInserts: true, onInvalidate: schedule })

  if (!isLoading && !error && round) {
    return <RoundPlayShell key={`${user?.id}:${round.id}`} round={round} />
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
