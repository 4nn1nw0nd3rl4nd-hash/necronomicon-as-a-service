import { useCallback, useEffect, useRef, useState } from 'react'
import {
  characterPortraitBucket,
  getCharacterPortraitPath,
  isValidCharacterPortraitId,
} from '../lib/characterPortrait'
import { supabase } from '../lib/supabase'

type CharacterPortraitState = {
  characterId: string | undefined
  portraitUrl: string | null
  isLoading: boolean
  error: string | null
}

const initialState: CharacterPortraitState = {
  characterId: undefined,
  portraitUrl: null,
  isLoading: false,
  error: null,
}

const loadError = 'Das Portrait konnte nicht geladen werden.'

export function useCharacterPortrait(characterId: string | undefined) {
  const [state, setState] = useState<CharacterPortraitState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)
  const objectUrlRef = useRef<string | null>(null)
  const clearVersionRef = useRef(0)
  const hasValidCharacterId = isValidCharacterPortraitId(characterId)

  useEffect(() => {
    if (!hasValidCharacterId) {
      return
    }

    let isCurrentRequest = true
    const clearVersion = clearVersionRef.current

    const isRequestCurrent = () =>
      isCurrentRequest && clearVersionRef.current === clearVersion

    const loadPortrait = async () => {
      setState({
        characterId,
        portraitUrl: null,
        isLoading: true,
        error: null,
      })

      try {
        const portraitPath = getCharacterPortraitPath(characterId)
        const { data: portraitFiles, error: listError } =
          await supabase.storage
            .from(characterPortraitBucket)
            .list(characterId, {
              limit: 10,
              search: 'portrait',
            })

        if (!isRequestCurrent()) {
          return
        }

        if (listError) {
          setState({
            characterId,
            portraitUrl: null,
            isLoading: false,
            error: loadError,
          })
          return
        }

        const portraitExists = portraitFiles.some(
          ({ name }) => name === 'portrait',
        )

        if (!portraitExists) {
          setState({
            characterId,
            portraitUrl: null,
            isLoading: false,
            error: null,
          })
          return
        }

        const { data, error } = await supabase.storage
          .from(characterPortraitBucket)
          .download(portraitPath)

        if (!isRequestCurrent()) {
          return
        }

        if (error) {
          setState({
            characterId,
            portraitUrl: null,
            isLoading: false,
            error: loadError,
          })
          return
        }

        const objectUrl = URL.createObjectURL(data)

        if (!isRequestCurrent()) {
          URL.revokeObjectURL(objectUrl)
          return
        }

        objectUrlRef.current = objectUrl
        setState({
          characterId,
          portraitUrl: objectUrl,
          isLoading: false,
          error: null,
        })
      } catch {
        if (!isRequestCurrent()) {
          return
        }

        setState({
          characterId,
          portraitUrl: null,
          isLoading: false,
          error: loadError,
        })
      }
    }

    void loadPortrait()

    return () => {
      isCurrentRequest = false

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [characterId, hasValidCharacterId, reloadKey])

  const reload = useCallback(() => {
    if (isValidCharacterPortraitId(characterId)) {
      setReloadKey((currentKey) => currentKey + 1)
    }
  }, [characterId])

  const clearPortrait = useCallback(() => {
    clearVersionRef.current += 1

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }

    setState({
      characterId,
      portraitUrl: null,
      isLoading: false,
      error: null,
    })
  }, [characterId])

  if (!hasValidCharacterId) {
    return {
      portraitUrl: null,
      isLoading: false,
      error: 'Portrait nicht verfügbar.',
      reload,
      clearPortrait,
    }
  }

  if (state.characterId !== characterId) {
    return {
      portraitUrl: null,
      isLoading: true,
      error: null,
      reload,
      clearPortrait,
    }
  }

  return {
    portraitUrl: state.portraitUrl,
    isLoading: state.isLoading,
    error: state.error,
    reload,
    clearPortrait,
  }
}
