import { usePresence } from '../motion';
﻿import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CircleCheck, Download } from 'lucide-react';
import type { Anime } from '../catalog';
import type { DownloadSeries } from '../../shared/downloads';
import { apiRequest } from '../api';
import { usePreferences } from '../PreferencesContext';
import { formatBytes, useDownloads } from './DownloadsContext';
import './downloads.css';

export const seriesProgress = (job: DownloadSeries) => job.episodes.reduce((sum, episode) => sum + (episode.status === 'complete' ? 1 : episode.progress), 0) / Math.max(1, job.episodes.length);

export function remainingTime(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds)) return 'Estimating time';
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}s remaining`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m remaining`;
  return `${Math.floor(seconds / 3600)}h ${Math.ceil(seconds % 3600 / 60)}m remaining`;
}

export function DownloadButton({ anime }: { anime: Anime }) {
  const { preferences } = usePreferences();
  const { data, refresh, loading } = useDownloads();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const job = data?.downloads.find(job => job.anime.id === anime.id && job.audio === preferences.audio && job.quality === preferences.downloadQuality);
  const active = !!job?.episodes.some(episode => episode.status === 'queued' || episode.status === 'downloading');
  const complete = !!job?.episodes.length && job.episodes.every(episode => episode.status === 'complete');
  const downloading = busy || active;
  const percent = active ? Math.min(99, Math.floor(seriesProgress(job!) * 100)) : 0;
  async function download() {
    setBusy(true); setError('');
    try {
      if (complete && job) await apiRequest(`/downloads/${job.id}`, { method: 'DELETE' });
      else await apiRequest('/downloads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ animeId: anime.id, audio: preferences.audio, provider: preferences.provider, fallback: preferences.providerFallback, quality: preferences.downloadQuality }) });
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Download could not be updated.'); }
    finally { setBusy(false); }
  }
  const label = active ? `Downloading ${anime.title}, ${percent}%` : complete ? `Remove download of ${anime.title}` : `Download all available episodes of ${anime.title}`;
  return <div className="series-download"><button type="button" className={`button secondary series-download-button${complete ? ' is-downloaded' : ''}`} data-state={downloading ? 'downloading' : complete ? 'downloaded' : 'undownloaded'} disabled={downloading || loading} onClick={() => void download()} aria-label={label} aria-busy={downloading} title={label}>
    {downloading ? <span className="download-percentage">{percent}%</span> : complete ? <CircleCheck size={20} aria-hidden="true" /> : <Download size={20} aria-hidden="true" />}
  </button>{error && <p className="download-inline-error" role="alert">{error}</p>}</div>;
}

export function DownloadsPopover() {
  const { data, error } = useDownloads();
  const [open, setOpen] = useState(false);
  const { mounted, ...presence } = usePresence(open);
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const location = useLocation();
  const active = data?.downloads.filter(job => job.episodes.some(episode => episode.status === 'queued' || episode.status === 'downloading')) || [];
  const progress = active.length ? active.reduce((sum, job) => sum + seriesProgress(job), 0) / active.length : 0;
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const dismiss = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  if (!data?.downloads.length) return null;
  return <div className="downloads-container" ref={container} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} type="button" className="downloads-trigger" aria-label={active.length ? `Downloads, ${Math.floor(progress * 100)}% complete` : 'Downloads'} aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>
      {active.length > 0 && <svg className="downloads-ring" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" /><circle cx="20" cy="20" r="17" pathLength="100" strokeDasharray={`${Math.max(2, progress * 100)} 100`} /></svg>}<Download size={19} strokeWidth={1.6} aria-hidden="true" />
    </button>
    {mounted && <div {...presence} className="downloads-popover motion-popover" ref={panel} id={id} role="dialog" aria-label="Downloads" tabIndex={-1}>
      <div className="downloads-list">{data.downloads.map(job => {
        const complete = job.episodes.filter(episode => episode.status === 'complete').length;
        const failed = job.episodes.filter(episode => episode.status === 'failed');
        const active = job.episodes.some(episode => episode.status === 'downloading' || episode.status === 'queued');
        const subtitle = `${complete}/${job.episodes.length}${active ? ` · ${formatBytes(Math.round(job.bytesPerSecond || 0))}/s · ${remainingTime(job.remainingSeconds)}` : failed.length ? ' · Download failed' : ''}`;
        return <Link to={`/anime/${job.anime.id}`} className="download-item" key={job.id} title={failed.map(episode => `Episode ${episode.number}: ${episode.error}`).join('\n') || job.artworkWarning}>
          <img className="download-cover" src={job.anime.cover || '/favicon.png'} alt="" />
          <div className="download-copy"><span className="download-title">{job.anime.title}</span><span className={`download-subheading${failed.length ? ' download-failure' : ''}`}>{subtitle}</span>{active && <progress className="download-progress" value={seriesProgress(job)} max={1} aria-label={`${job.anime.title} download progress`} />}</div>
        </Link>;
      })}</div>
      {error && <p className="download-popover-error" role="alert">{error}</p>}
    </div>}
  </div>;
}
