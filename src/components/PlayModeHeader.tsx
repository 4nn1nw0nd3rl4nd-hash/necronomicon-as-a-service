import { useRef } from 'react'
import type { RefObject } from 'react'
import { Link } from 'react-router-dom'
import type { PlayTab } from './PlayMainContent'

const tabs: { id: PlayTab; label: string }[] = [
  { id: 'table', label: 'Spieltisch' },
  { id: 'character', label: 'Charakter' },
  { id: 'notes', label: 'Notizen' },
]

type PlayModeHeaderProps = {
  roundId: string
  roundName: string
  activeTab: PlayTab
  onTabChange: (tab: PlayTab) => void
  isChatOpen: boolean
  onChatToggle: () => void
  chatToggleRef: RefObject<HTMLButtonElement | null>
  unreadCount: number
}

function PlayModeHeader({
  roundId, roundName, activeTab, onTabChange, isChatOpen, onChatToggle, chatToggleRef, unreadCount,
}: PlayModeHeaderProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  return (
    <header className="play-header">
      <Link className="round-detail-back" to={`/app/rounds/${roundId}`}>
        ← Zur Rundenübersicht
      </Link>
      <div className="play-title-row">
        <div>
          <p className="play-eyebrow">Spielmodus</p>
          <h1>{roundName}</h1>
        </div>
        <button
          ref={chatToggleRef}
          className="play-button"
          type="button"
          aria-expanded={isChatOpen}
          aria-controls="play-chat"
          onClick={onChatToggle}
        >
          {isChatOpen ? 'Chat ausblenden' : 'Chat öffnen'}
          {!isChatOpen && unreadCount > 0 && <span className="play-chat-unread" aria-label={`${unreadCount} neue Nachrichten`}>{unreadCount}</span>}
        </button>
      </div>
      <div className="play-tabs" role="tablist" aria-label="Spielinhalt">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={element => { tabRefs.current[index] = element }}
            className="play-button"
            type="button"
            role="tab"
            id={`play-tab-${tab.id}`}
            aria-controls="play-main-content"
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={event => {
              let next: number
              if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
              else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
              else if (event.key === 'Home') next = 0
              else if (event.key === 'End') next = tabs.length - 1
              else return
              event.preventDefault()
              onTabChange(tabs[next].id)
              tabRefs.current[next]?.focus()
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </header>
  )
}

export default PlayModeHeader
