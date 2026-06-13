'use client';

import { useEffect, useState } from 'react';

export function useServerEnv() {
  const [env, setEnv] = useState<string>('development');

  useEffect(() => {
    fetch('/api/v1/config/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.server?.env?.value) {
          setEnv(data.server.env.value);
        }
      })
      .catch(() => { /* ignore — settings endpoint may be unavailable */ });
  }, []);

  return env;
}
