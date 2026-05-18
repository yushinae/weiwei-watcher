import { useCallback, useState } from 'react';
import type { MonitorSelection } from '../types';

export function useMonitorSelection(initial: MonitorSelection = { type: 'none' }) {
  const [selection, setSelection] = useState<MonitorSelection>(initial);

  const clearSelection = useCallback(() => setSelection({ type: 'none' }), []);

  return {
    selection,
    setSelection,
    clearSelection,
    open: selection.type !== 'none',
  };
}

