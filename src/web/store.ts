import { create } from 'zustand';
import type { RangeKey } from '../shared/types.js';

interface StoreState {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
}

export const useStore = create<StoreState>((set) => ({
  range: 'month',
  setRange: (range) => set({ range }),
}));
