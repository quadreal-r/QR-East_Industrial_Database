import { useEffect, useState } from 'react'

/** Phones and narrow tablets — search + map layout, no Cost Center. */
export const MOBILE_BREAKPOINT_PX = 768

function readIsMobile(query: MediaQueryList | null): boolean {
  if (typeof window === 'undefined') return false
  return (query ?? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`)).matches
}

/** True when the viewport is below the mobile breakpoint. */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => readIsMobile(null))

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`)
    const sync = () => setIsMobile(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  return isMobile
}
