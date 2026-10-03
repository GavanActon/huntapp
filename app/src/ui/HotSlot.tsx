import { useRef, type JSX } from 'react'
import type { HotId } from '../state/appStore'
import { HOT_DEFS, HotButton } from './hotButtons'
import HotDrawer from './HotDrawer'

/** A hot button's place in its column: the button, and its drawer when held
 *  open (the button ringed in the drawer's colour, so the two read as one). */
export default function HotSlot({ id, labels, open, onOpen, onClose }: { id: HotId; labels: boolean; open: boolean; onOpen: () => void; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className={`hotslot${labels ? '' : ' no-label'}${open ? ' held' : ''}`} ref={ref}>
      <HotButton
        id={id}
        onHold={onOpen}
        onTap={() => {
          HOT_DEFS[id].onTap()
          if (open) onClose()
        }}
      />
      {open && <HotDrawer id={id} within={ref} onClose={onClose} />}
    </div>
  )
}
