import { useEffect, useRef } from 'react';
import { useAppStore } from '../../../store';

/** Keep-alive data screens must reread pipelines changed by a project conversation. */
export function useDataWorkspaceActivation(onActivate: () => void) {
  const view = useAppStore((state) => state.mainView);
  const previous = useRef(view);
  useEffect(() => {
    const returning = view === 'data' && previous.current !== 'data';
    previous.current = view;
    if (returning) onActivate();
  }, [view, onActivate]);
}
