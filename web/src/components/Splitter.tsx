import type { PointerEvent as ReactPointerEvent } from 'react'

interface Props {
  axis: 'x' | 'y'
  // Called with the pointer's position along the axis while it is dragged.
  onMove: (position: number) => void
  onReset: () => void
}

// A border between two areas that the mouse can drag; a double click restores the default size.
export function Splitter({ axis, onMove, onReset }: Props) {
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => onMove(axis === 'x' ? ev.clientX : ev.clientY)
    const stop = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', stop)
      document.body.classList.remove('select-none')
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', stop)
    document.body.classList.add('select-none')
  }

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      title="Потягни, щоб змінити розмір; подвійний клік повертає типовий"
      onPointerDown={start}
      onDoubleClick={onReset}
      className={`shrink-0 bg-line transition-colors hover:bg-accent/50 active:bg-accent ${
        axis === 'x' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'
      }`}
    />
  )
}
