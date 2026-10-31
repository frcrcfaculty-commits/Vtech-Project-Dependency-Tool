import { useEffect } from 'react';

/** Close a dialog on Escape (unless it is busy saving). */
export function useEscape(onClose: () => void, busy = false) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, busy]);
}
