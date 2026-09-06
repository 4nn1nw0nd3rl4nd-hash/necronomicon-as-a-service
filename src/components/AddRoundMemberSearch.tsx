import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useAddRoundPlayer } from '../hooks/useAddRoundPlayer'
import { useRoundPlayerSuggestions } from '../hooks/useRoundPlayerSuggestions'
import type { RoundMember, RoundMemberProfile } from '../types/round'

type AddRoundMemberSearchProps = {
  roundId: string
  currentUserId: string
  members: RoundMember[]
  onPlayerAdded: () => void
}

function AddRoundMemberSearch({ roundId, currentUserId, members, onPlayerAdded }: AddRoundMemberSearchProps) {
  const id = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [username, setUsername] = useState('')
  const [selected, setSelected] = useState<RoundMemberProfile | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const { results, status } = useRoundPlayerSuggestions(roundId, selected ? '' : username)
  const { isSubmitting, error: addError, isSuccess, addPlayer, resetState } = useAddRoundPlayer()
  const isEligible = (userId: string) => userId !== currentUserId && !members.some(member => member.user_id === userId)
  const suggestions = results.filter(result => isEligible(result.id))
  const showSuggestions = isOpen && !selected && Boolean(username.trim())
  const activeOption = showSuggestions ? suggestions[activeIndex] : undefined
  const canAdd = selected && isEligible(selected.id) && !isSubmitting

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setIsOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])

  useEffect(() => {
    if (activeOption) document.getElementById(`${id}-${activeOption.id}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeOption, id])

  const choose = (profile: RoundMemberProfile) => {
    setSelected(profile)
    setUsername(profile.username)
    setIsOpen(false)
    setActiveIndex(-1)
    resetState()
    inputRef.current?.focus()
  }

  const handleKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setIsOpen(true)
      if (suggestions.length) {
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setActiveIndex(index => !isOpen || index < 0
          ? direction === 1 ? 0 : suggestions.length - 1
          : (index + direction + suggestions.length) % suggestions.length)
      }
    } else if (event.key === 'Enter' && !selected) {
      event.preventDefault()
      if (activeOption) choose(activeOption)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setIsOpen(false)
      setActiveIndex(-1)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canAdd) return
    setIsOpen(false)
    if (await addPlayer(roundId, selected.id)) {
      setUsername('')
      setSelected(null)
      setActiveIndex(-1)
      onPlayerAdded()
    }
  }

  return (
    <section className="add-round-member-search" aria-labelledby={`${id}-title`}>
      <h3 className="add-round-member-search-title" id={`${id}-title`}>Spieler hinzufügen</h3>
      <form className="add-round-member-search-form" onSubmit={handleSubmit} noValidate>
        <div className="round-player-combobox" ref={containerRef}
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false)
          }}>
          <label className="auth-field" htmlFor={`${id}-input`}>
            <span>Benutzername</span>
            <input id={`${id}-input`} ref={inputRef} type="text" role="combobox"
              autoComplete="off" autoCapitalize="none" spellCheck={false}
              aria-autocomplete="list" aria-expanded={showSuggestions}
              aria-controls={`${id}-list`} aria-activedescendant={activeOption ? `${id}-${activeOption.id}` : undefined}
              aria-describedby={`${id}-status`} value={username} disabled={isSubmitting}
              onChange={event => {
                setUsername(event.target.value)
                setSelected(null)
                setActiveIndex(-1)
                setIsOpen(true)
                resetState()
              }}
              onFocus={() => setIsOpen(true)} onKeyDown={handleKeys} />
          </label>
          {showSuggestions && (
            <ul className="round-player-suggestions" id={`${id}-list`} role="listbox" aria-label="Passende Nutzer">
              {suggestions.map((profile, index) => (
                <li key={profile.id} id={`${id}-${profile.id}`} role="option" tabIndex={-1}
                  aria-selected={activeOption?.id === profile.id}
                  onPointerDown={event => {
                    // Keep input focus until click selects the option; touch scrolling stays native.
                    if (event.pointerType === 'mouse') event.preventDefault()
                  }}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => choose(profile)}>
                  <strong>{profile.display_name}</strong><span>@{profile.username}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="auth-submit" type="submit" disabled={!canAdd} data-submitting={isSubmitting}>
          {isSubmitting ? 'Wird hinzugefügt...' : 'Hinzufügen'}
        </button>
      </form>
      <p className="round-player-search-status" id={`${id}-status`} role="status">
        {showSuggestions && (status === 'loading' ? 'Nutzer werden gesucht…'
          : status === 'error' ? 'Die Suche ist fehlgeschlagen. Bitte ändere die Eingabe, um es erneut zu versuchen.'
          : status === 'success' && suggestions.length === 0 ? 'Keine passenden Nutzer gefunden.'
          : results.length === 10 ? 'Bis zu 10 Treffer. Bitte grenze den Benutzernamen bei Bedarf weiter ein.' : '')}
        {selected && `Ausgewählt: ${selected.display_name} (@${selected.username})`}
      </p>
      {addError && <p className="profile-form-error" role="alert">{addError}</p>}
      {isSuccess && <p className="profile-form-success" role="status">Spieler wurde hinzugefügt.</p>}
    </section>
  )
}

export default AddRoundMemberSearch
