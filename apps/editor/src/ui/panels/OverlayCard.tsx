/**
 * A floating overlay card — the editor chrome's FigJam-style container.
 *
 * The editor pane is a full-bleed canvas; its chrome (the World card, the
 * Inspector card) floats above it in cards that collapse away to chips.
 * This component is only the card half of that deal: a title row with a
 * collapse button, and a body that HIDES rather than unmounts — the anchor
 * registry promises every registered anchor exists in the mounted UI, and
 * panels full of data-anchor attributes live inside these bodies, so a
 * collapsed card keeps its DOM and loses only its pixels. (The matching
 * chip that re-opens a closed card is the pane's business — chips dock
 * together at the bottom-left regardless of where their cards float.)
 *
 * `open=false` hides the WHOLE card (chip territory); the collapse button
 * carries aria-expanded so the fold is announced, not just seen.
 */

import type { ReactElement, ReactNode } from 'react'

export function OverlayCard({
  title,
  open,
  onCollapse,
  className,
  children,
}: {
  title: string
  open: boolean
  onCollapse: () => void
  className: string
  children: ReactNode
}): ReactElement {
  return (
    <div className={open ? `overlay-card ${className}` : `overlay-card closed ${className}`}>
      <div className="card-head">
        <p className="card-title">{title}</p>
        <button
          type="button"
          className="card-collapse"
          aria-expanded={open}
          aria-label={`Collapse the ${title} card`}
          onClick={onCollapse}
        >
          —
        </button>
      </div>
      <div className="card-body">{children}</div>
    </div>
  )
}
