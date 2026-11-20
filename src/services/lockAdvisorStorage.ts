import { STORAGE_KEYS } from './storage';
import type { LockDecision, LockMediaType } from './lockAdvisor';

export interface LockAdvisorHistoryItem {
  id: string;
  timestamp: number;
  task: string;
  media: LockMediaType;
  pinnedLocks: number[];
  decision: LockDecision;
}

export interface LockAdvisorPinPreset {
  id: string;
  name: string;
  pinnedLocks: number[];
  createdAt: number;
}

const MAX_HISTORY_ITEMS = 10;

const DEFAULT_PIN_PRESETS: LockAdvisorPinPreset[] = [
  {
    id: 'preset_identity_body',
    name: 'Identity + Skin + Body',
    pinnedLocks: [2, 3, 5],
    createdAt: 1,
  },
  {
    id: 'preset_portrait_strict',
    name: 'Portrait Strict (Color, Face, Skin, Hair, Body)',
    pinnedLocks: [1, 2, 3, 4, 5],
    createdAt: 2,
  },
];

function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(`Lock Advisor storage quota warning for ${key}:`, err);
    return false;
  }
}

function cleanPinnedIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  return Array.from(
    new Set(
      ids
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 13)
    )
  ).sort((a, b) => a - b);
}

export const LockAdvisorStorage = {
  getHistory(): LockAdvisorHistoryItem[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LOCK_ADVISOR_HISTORY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, MAX_HISTORY_ITEMS);
    } catch {
      return [];
    }
  },

  saveHistoryItem(entry: Omit<LockAdvisorHistoryItem, 'id' | 'timestamp'>): LockAdvisorHistoryItem[] {
    const cleanEntry: LockAdvisorHistoryItem = {
      id: `lock_hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      task: String(entry.task || '').trim(),
      media: entry.media === 'video' ? 'video' : 'image',
      pinnedLocks: cleanPinnedIds(entry.pinnedLocks),
      // Store decision JSON only — zero image payloads ever stored
      decision: JSON.parse(JSON.stringify(entry.decision)) as LockDecision,
    };

    const existing = this.getHistory().filter(
      (item) => !(item.task === cleanEntry.task && item.media === cleanEntry.media)
    );
    const updated = [cleanEntry, ...existing].slice(0, MAX_HISTORY_ITEMS);

    if (!safeSetItem(STORAGE_KEYS.LOCK_ADVISOR_HISTORY, JSON.stringify(updated))) {
      // Quota fallback: retain most recent 5 entries
      const trimmed = updated.slice(0, 5);
      safeSetItem(STORAGE_KEYS.LOCK_ADVISOR_HISTORY, JSON.stringify(trimmed));
      return trimmed;
    }
    return updated;
  },

  deleteHistoryItem(id: string): LockAdvisorHistoryItem[] {
    const updated = this.getHistory().filter((item) => item.id !== id);
    safeSetItem(STORAGE_KEYS.LOCK_ADVISOR_HISTORY, JSON.stringify(updated));
    return updated;
  },

  clearHistory(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.LOCK_ADVISOR_HISTORY);
    } catch {
      // ignore
    }
  },

  getPresets(): LockAdvisorPinPreset[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LOCK_ADVISOR_PRESETS);
      if (!raw) {
        safeSetItem(STORAGE_KEYS.LOCK_ADVISOR_PRESETS, JSON.stringify(DEFAULT_PIN_PRESETS));
        return DEFAULT_PIN_PRESETS;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return DEFAULT_PIN_PRESETS;
      }
      return parsed;
    } catch {
      return DEFAULT_PIN_PRESETS;
    }
  },

  savePreset(name: string, pinnedLocks: number[]): LockAdvisorPinPreset[] {
    const cleanName = name.trim();
    const cleanedPins = cleanPinnedIds(pinnedLocks);
    if (!cleanName || cleanedPins.length === 0) return this.getPresets();

    const list = this.getPresets();
    const existingIdx = list.findIndex(
      (p) => p.name.toLowerCase() === cleanName.toLowerCase()
    );
    const record: LockAdvisorPinPreset = {
      id: existingIdx >= 0 ? list[existingIdx].id : `lock_preset_${Date.now()}`,
      name: cleanName,
      pinnedLocks: cleanedPins,
      createdAt: Date.now(),
    };

    const next =
      existingIdx >= 0
        ? list.map((p, idx) => (idx === existingIdx ? record : p))
        : [record, ...list];

    safeSetItem(STORAGE_KEYS.LOCK_ADVISOR_PRESETS, JSON.stringify(next));
    return next;
  },

  deletePreset(id: string): LockAdvisorPinPreset[] {
    const next = this.getPresets().filter((p) => p.id !== id);
    safeSetItem(STORAGE_KEYS.LOCK_ADVISOR_PRESETS, JSON.stringify(next));
    return next;
  },
};
