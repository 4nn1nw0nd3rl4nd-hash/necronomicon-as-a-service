import { useCallback, useEffect, useEffectEvent, useRef } from 'react'

// Local to its mounted consumer: no polling, global bus or extra channel.
export function useFocusReconciliation(
  scopeKey: string | undefined,
  onReconcile: () => void,
  reconnectVersion = 0,
) {
  const reconcile = useEffectEvent(onReconcile)
  const scheduleRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!scopeKey) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        reconcile()
      }, 100)
    }
    const onReturn = () => {
      if (document.visibilityState === 'visible') schedule()
    }
    scheduleRef.current = schedule
    window.addEventListener('focus', onReturn)
    window.addEventListener('online', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      scheduleRef.current = null
      clearTimeout(timer)
      window.removeEventListener('focus', onReturn)
      window.removeEventListener('online', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [scopeKey])
  const schedule = useCallback(() => scheduleRef.current?.(), [])
  useEffect(() => {
    if (reconnectVersion > 0) schedule()
  }, [reconnectVersion, schedule, scopeKey])
  return schedule
}
