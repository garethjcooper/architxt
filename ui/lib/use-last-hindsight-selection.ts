'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'architxt:lastHindsightSelection';

interface StoredSelection {
  serverId: string;
  bankId: string;
}

function readStored(): StoredSelection | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.serverId === 'string' && typeof parsed.bankId === 'string') {
      return parsed;
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}

function writeStored(serverId: string, bankId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ serverId, bankId }));
  } catch {
    // ignore storage errors
  }
}

/**
 * Persist and restore the last selected hindsight server/bank pair.
 * Returns the stored ids and a setter that writes back to localStorage.
 */
export function useLastHindsightSelection() {
  const [stored, setStored] = useState<StoredSelection | null>(null);

  useEffect(() => {
    setStored(readStored());
  }, []);

  const save = useCallback((serverId: string, bankId: string) => {
    writeStored(serverId, bankId);
    setStored({ serverId, bankId });
  }, []);

  return { stored, save };
}
