'use client';

import { useState, useEffect, useCallback } from 'react';
import { ApiError } from '@/lib/api/client';

/**
 * Generic data fetching hook for architxt API
 */
export function useApi(fetchFn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      setData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(err.message, 500, 'CLIENT_ERROR'));
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

export function useApiMutation(mutationFn) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await mutationFn(...args);
      return { success: true, data: result };
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(err.message, 500, 'CLIENT_ERROR'));
      return { success: false, error: err };
    } finally {
      setLoading(false);
    }
  };

  return { execute, loading, error };
}
