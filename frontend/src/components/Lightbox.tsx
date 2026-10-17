import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

interface Props {
  images: [string, string][] // [url, label]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
}

// In-page image carousel: arrows, keyboard (← → Esc), click outside to close.
export default function Lightbox({ images, index, onIndex, onClose }: Props) {
  const n = images.length
  const go = (d: number) => onIndex((index + d + n) % n)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onIndex((index + 1) % n)
      if (e.key === 'ArrowLeft') onIndex((index - 1 + n) % n)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, n, onClose, onIndex])

  const [url, label] = images[index]
  const nav = 'absolute top-1/2 -translate-y-1/2 rounded-[3.6px] border border-iron bg-canvas/80 p-3 text-bone hover:border-lime hover:text-lime'

  // Portal to <body>: the detail drawer uses backdrop-filter, which would trap a `fixed` overlay inside it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/95 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-label="Image viewer">
      <figure className="flex max-h-full flex-col items-center gap-3 p-16" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt={label} className="max-h-[78vh] max-w-[80vw] border border-iron object-contain" />
        <figcaption className="font-mono text-[13px] uppercase tracking-wider text-ash">
          <span className="text-lime">{index + 1}/{n}</span> · {label}
        </figcaption>
      </figure>
      {n > 1 && (
        <>
          <button type="button" aria-label="Previous image" className={`${nav} left-6`} onClick={(e) => { e.stopPropagation(); go(-1) }}>
            <ChevronLeft className="size-6" />
          </button>
          <button type="button" aria-label="Next image" className={`${nav} right-6`} onClick={(e) => { e.stopPropagation(); go(1) }}>
            <ChevronRight className="size-6" />
          </button>
        </>
      )}
      <button type="button" aria-label="Close" className="absolute right-6 top-6 rounded-[3.6px] border border-iron p-2 text-bone hover:border-lime hover:text-lime" onClick={onClose}>
        <X className="size-5" />
      </button>
    </div>,
    document.body,
  )
}
