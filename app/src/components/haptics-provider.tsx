import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect } from 'react'
import { useWebHaptics } from 'web-haptics/react'

import { registerHapticTrigger } from '@/lib/haptics'
import { isNativePlatform } from '@/lib/native-platform'
import { nativeHapticTrigger } from '@/lib/native-shell'
import { $hapticsMuted } from '@/store/haptics'

export function HapticsProvider({ children }: { children: ReactNode }) {
  const muted = useStore($hapticsMuted)
  const { trigger } = useWebHaptics({ debug: true, showSwitch: false })

  useEffect(() => {
    // On native the web-haptics trigger (a trackpad-actuator AudioContext hack)
    // does nothing on a phone, so route to Capacitor Haptics instead. Browser
    // and Electron keep the web-haptics trigger exactly as before.
    const active = isNativePlatform() ? nativeHapticTrigger : trigger

    registerHapticTrigger(muted ? null : active)

    return () => registerHapticTrigger(null)
  }, [muted, trigger])

  // web-haptics builds its AudioContext lazily inside the first trigger(), and
  // the process's first AudioContext pays the CoreAudio spin-up (~850ms stall
  // in profiles) — which landed on the first streamStart haptic as the first
  // token painted. Open/close a throwaway context at idle so the real one
  // connects to an already-warm audio service in single-digit ms.
  useEffect(() => {
    if (typeof requestIdleCallback !== 'function' || typeof AudioContext === 'undefined') {
      return undefined
    }

    const id = requestIdleCallback(
      () => {
        try {
          void new AudioContext().close().catch(() => undefined)
        } catch {
          // No audio device (headless CI) — nothing to warm.
        }
      },
      { timeout: 2000 }
    )

    return () => cancelIdleCallback(id)
  }, [])

  return <>{children}</>
}
