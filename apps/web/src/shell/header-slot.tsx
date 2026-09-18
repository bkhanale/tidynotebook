/**
 * The place a route puts its own actions in the frame header.
 *
 * The header is the context of the route: the sidebar toggle and the
 * breadcrumb on the left, then the actions of the route, then Search and the
 * account. The frame cannot know those actions, because they belong to the
 * screen, and the screen cannot reach the header, because it renders below
 * it. This module is the one link between the two. See
 * [decision 0064](../../../../docs/decisions/0064-the-frame-header-is-the-context-of-the-route.md).
 *
 * The slot is a portal and not a node held in state. A route passes a new
 * element on every render, so a provider that kept the element in state would
 * set that state from the route, re-render the route, and receive a new
 * element again: one render loop with no fixed point. A portal writes the
 * nodes of the route into an element of the header, so React owns the order,
 * the keys and the clean up, and the header re-renders only when the header
 * changes.
 *
 * The shell renders one `HeaderSlot` inside the header and each route renders
 * at most one `HeaderActions`. A screen with no action of its own renders
 * none, and the header shows an empty middle.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** What the frame publishes and a route reads. */
type HeaderSlotValue = {
  /** The element of the header that holds the actions of the route. */
  readonly host: HTMLElement | null;
  /** The frame calls this with the element it rendered, and with null. */
  readonly setHost: (element: HTMLElement | null) => void;
};

const HeaderSlotContext = createContext<HeaderSlotValue | null>(null);

/**
 * Holds the header slot for one application frame.
 *
 * It wraps the whole frame, so the header and every route read one slot.
 */
export function HeaderSlotProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const [host, setHost] = useState<HTMLElement | null>(null);
  return (
    <HeaderSlotContext.Provider value={{ host, setHost }}>
      {children}
    </HeaderSlotContext.Provider>
  );
}

/**
 * Reads the header slot.
 *
 * A component outside a `HeaderSlotProvider` receives a slot with no host, so
 * a screen rendered on its own, such as an error page, renders its actions
 * nowhere instead of failing.
 */
export function useHeaderSlot(): HeaderSlotValue {
  return (
    useContext(HeaderSlotContext) ?? {
      host: null,
      setHost: (): void => undefined,
    }
  );
}

/**
 * The element of the header that the actions of the route render into.
 *
 * The frame renders this once, where the actions belong. The `ref` callback
 * publishes the element while it is in the document and clears it when the
 * frame unmounts, so a route never writes into an element that has gone.
 */
export function HeaderSlot({
  className,
}: {
  readonly className?: string | undefined;
}): ReactNode {
  const { setHost } = useHeaderSlot();
  return <div className={className} ref={setHost} />;
}

/**
 * The actions of one route, placed in the header.
 *
 * A route renders this with its own buttons and menus. It draws nothing until
 * the frame has published its element, which is the first paint of the frame,
 * so the header never shows the actions of the route it just left.
 */
export function HeaderActions({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  const { host } = useHeaderSlot();
  if (host === null) return null;
  return createPortal(children, host);
}
