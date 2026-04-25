import { create } from 'zustand';
import type { RangeKey } from '../shared/types.js';

const COMPACT_KEY = 'ccCompactNumbers';

function readCompact(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const raw = localStorage.getItem(COMPACT_KEY);
  return raw === null ? true : raw === '1';
}

interface StoreState {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  compactNumbers: boolean;
  setCompactNumbers: (v: boolean) => void;
}

export const useStore = create<StoreState>((set) => ({
  range: 'month',
  setRange: (range) => set({ range }),
  compactNumbers: readCompact(),
  setCompactNumbers: (compactNumbers) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COMPACT_KEY, compactNumbers ? '1' : '0');
    }
    set({ compactNumbers });
  },
}));
