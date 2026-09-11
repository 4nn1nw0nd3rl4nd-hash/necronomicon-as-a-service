import { useCallback, useEffect, useRef, useState } from 'react'
import {
  characterPortraitBucket,
  characterPortraitMaxFileSize,
  getCharacterPortraitPath,
  isAllowedCharacterPortraitMimeType,
  isValidCharacterPortraitId,
} from '../lib/characterPortrait'
import { supabase } from '../lib/supabase'

const uploadError =
  'Das Portrait konnte nicht gespeichert werden. Bitte versuche es erneut.'

export function useUploadCharacterPortrait() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isRequestInFlightRef = useRef(false)
  const lifecycle = useRef(0)
  useEffect(() => {
    const generation = ++lifecycle.current
    return () => { lifecycle.current = generation + 1 }
  }, [])

  const resetState = useCallback(() => {
    setError(null)
  }, [])

  const uploadCharacterPortrait = useCallback(
    async (characterId: string, file: File): Promise<boolean> => {
      if (isRequestInFlightRef.current) {
        return false
      }

      if (!isValidCharacterPortraitId(characterId)) {
        setError(uploadError)
        return false
      }

      if (!isAllowedCharacterPortraitMimeType(file.type)) {
        setError('Bitte wähle eine JPEG-, PNG- oder WebP-Datei aus.')
        return false
      }

      if (file.size > characterPortraitMaxFileSize) {
        setError('Das Portrait darf höchstens 5 MB groß sein.')
        return false
      }

      const generation = lifecycle.current
      isRequestInFlightRef.current = true
      setIsSubmitting(true)
      setError(null)

      try {
        const { error: requestError } = await supabase.storage
          .from(characterPortraitBucket)
          .upload(getCharacterPortraitPath(characterId), file, {
            upsert: true,
            contentType: file.type,
          })

        if (generation !== lifecycle.current) return false
        if (requestError) {
          setError(uploadError)
          return false
        }

        return true
      } catch {
        if (generation !== lifecycle.current) return false
        setError(uploadError)
        return false
      } finally {
        isRequestInFlightRef.current = false
        if (generation === lifecycle.current) setIsSubmitting(false)
      }
    },
    [],
  )

  return {
    isSubmitting,
    error,
    uploadCharacterPortrait,
    resetState,
  }
}
