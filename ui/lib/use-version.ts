'use client';

import { useEffect, useState } from 'react';

interface VersionInfo {
  version: string;
  commit: string;
}

export function useVersion() {
  const [version, setVersion] = useState<VersionInfo | null>(null);

  useEffect(() => {
    fetch('/version.json')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => data ? setVersion(data as VersionInfo) : null)
      .catch(() => { /* ignore — version.json is optional */ });
  }, []);

  return version;
}
