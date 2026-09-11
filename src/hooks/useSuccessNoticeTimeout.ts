import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

// Each new action state cancels the previous notice's timer; errors stay intact.
export function useSuccessNoticeTimeout<T extends { isSuccess: boolean }>(
  state: T,
  setState: Dispatch<SetStateAction<T>>,
) {
  useEffect(() => {
    if (!state.isSuccess) return

    const timer = setTimeout(() => {
      setState(current => current === state
        ? { ...current, isSuccess: false }
        : current)
    }, 4000)

    return () => clearTimeout(timer)
  }, [state, setState])
}
