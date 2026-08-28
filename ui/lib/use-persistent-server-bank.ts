'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLastHindsightSelection } from './use-last-hindsight-selection';

interface ServerLike {
  id: number | string;
}

interface BankLike {
  bank_id: string;
}

/**
 * Manage server/bank selection state with localStorage persistence.
 * Restores the last valid stored pair when the server/bank lists load,
 * and writes back whenever the user changes the selection.
 */
export function usePersistentServerBank<S extends ServerLike, B extends BankLike>(
  servers: S[],
  banks: B[]
) {
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const { stored, save } = useLastHindsightSelection();

  // Restore server once the server list is available.
  useEffect(() => {
    if (servers.length === 0 || selectedServerId) return;
    if (stored?.serverId && servers.some((s) => String(s.id) === stored.serverId)) {
      setSelectedServerId(stored.serverId);
    }
  }, [servers, stored, selectedServerId]);

  // Restore bank once the bank list is available for the selected server.
  useEffect(() => {
    if (banks.length === 0 || selectedBankId) return;
    if (stored?.bankId && banks.some((b) => b.bank_id === stored.bankId)) {
      setSelectedBankId(stored.bankId);
    }
  }, [banks, stored, selectedBankId]);

  const handleSetServerId = useCallback(
    (id: string) => {
      setSelectedServerId(id);
      setSelectedBankId('');
      if (id) save(id, '');
    },
    [save]
  );

  const handleSetBankId = useCallback(
    (id: string) => {
      setSelectedBankId(id);
      if (id && selectedServerId) {
        save(selectedServerId, id);
      }
    },
    [selectedServerId, save]
  );

  const saveSessionId = useCallback(
    (sessionId: number) => {
      if (selectedServerId && selectedBankId) {
        save(selectedServerId, selectedBankId, sessionId);
      }
    },
    [selectedServerId, selectedBankId, save]
  );

  return {
    selectedServerId,
    setSelectedServerId: handleSetServerId,
    selectedBankId,
    setSelectedBankId: handleSetBankId,
    saveSessionId,
    lastSessionId: stored?.sessionId,
  };
}
