// Minimal typing for the one react-dom API the app uses (no @types/react-dom installed).
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal;
}
