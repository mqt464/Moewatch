import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiRequest } from '../api';
import type { DownloadsResponse } from '../../shared/downloads';

type DownloadsContextValue = { data: DownloadsResponse | null; loading: boolean; error: string; refresh: () => Promise<void> };
const Context = createContext<DownloadsContextValue>({ data: null, loading: true, error: '', refresh: async () => {} });
export const useDownloads = () => useContext(Context);

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DownloadsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const result = await apiRequest<DownloadsResponse>('/downloads');
      if (!Array.isArray(result.downloads) || typeof result.location !== 'string' || !result.storage) throw new Error('Moewatch returned invalid download data.');
      setData(result); setError('');
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Downloads could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!stopped) timeout = setTimeout(poll, 2000); };
    void poll();
    return () => { stopped = true; clearTimeout(timeout); };
  }, [refresh]);
  return <Context.Provider value={{ data, loading, error, refresh }}>{children}</Context.Provider>;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${Math.max(0, bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)) - 1);
  return `${(bytes / 1024 ** (index + 1)).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}
