import { create } from 'zustand';
import type { RangeKey } from '../shared/types.js';

const COMPACT_KEY = 'ccCompactNumbers';
const SOURCE_KEY = 'ccSourceFilter';

export type SourceFilter = 'all' | 'claude' | 'codex';

function readCompact(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const raw = localStorage.getItem(COMPACT_KEY);
  return raw === null ? true : raw === '1';
}

function readSource(): SourceFilter {
  if (typeof localStorage === 'undefined') return 'all';
  const v = localStorage.getItem(SOURCE_KEY);
  return v === 'claude' || v === 'codex' ? v : 'all';
}

interface StoreState {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  compactNumbers: boolean;
  setCompactNumbers: (v: boolean) => void;
  sourceFilter: SourceFilter;
  setSourceFilter: (s: SourceFilter) => void;
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
  sourceFilter: readSource(),
  setSourceFilter: (sourceFilter) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SOURCE_KEY, sourceFilter);
    }
    set({ sourceFilter });
  },
}));
