import { useCallback, useEffect, useState } from 'react'

// Sizes are pixels; the layout is this viewer's preference, so it lives in the browser.
export interface Layout {
  textWidth: number
  textHidden: boolean
  consoleHeight: number
  consoleOpen: boolean
}

const KEY = 'hot-table:layout:v1'

const defaults = (): Layout => ({
  textWidth: Math.round(window.innerWidth * 0.34),
  textHidden: false,
  consoleHeight: Math.round(window.innerHeight * 0.38),
  consoleOpen: false,
})

function load(): Layout {
  try {
    return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return defaults()
  }
}

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout))
    } catch {
      // Private windows may refuse storage; the layout then lasts until the page reloads.
    }
  }, [layout])

  const update = useCallback((patch: Partial<Layout> | ((current: Layout) => Partial<Layout>)) => {
    setLayout((current) => ({ ...current, ...(typeof patch === 'function' ? patch(current) : patch) }))
  }, [])

  const reset = useCallback((keys: (keyof Layout)[]) => {
    const fresh = defaults()
    setLayout((current) => ({ ...current, ...Object.fromEntries(keys.map((k) => [k, fresh[k]])) }))
  }, [])

  return { layout, update, reset }
}
