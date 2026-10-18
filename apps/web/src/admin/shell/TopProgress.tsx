import { useEffect, useState } from 'react'
import { usePendingWork } from '../../lib/progress.ts'

const SHOW_AFTER_MS = 150
const MIN_VISIBLE_MS = 300

/** Thin bar across the top while API calls or lazy screens are pending; hidden for waits under 150 ms. */
export function TopProgress() {
  const pending = usePendingWork()
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (pending) {
      const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => setVisible(false), visible ? MIN_VISIBLE_MS : 0)
    return () => clearTimeout(timer)
  }, [pending, visible])
  return <div aria-hidden="true" className={`pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}>
    <div className="h-full w-2/5 animate-progress rounded-full bg-primary" />
  </div>
}
