import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CinemaControls } from './CinemaControls';
import { fetchServers, providerNames, resolvePlayback } from '../api';
import type { SubtitleTrack } from '../../shared/api';
import type { Anime } from '../catalog';
import type { Progress } from '../library';
import { usePreferences } from '../PreferencesContext';
import { type AudioPreference, type PlaybackResponse, type PlaybackSource, type ProviderPreference, type ProviderServer } from '../../shared/api';
import { availableEpisodes, useAvailability } from './availability';
import { canResume, Player, togglePlayback } from './Player';
import './playback.css';
import { useDiscordPresence } from './discord';
import { useDownloads } from '../downloads/DownloadsContext';
import { PartyAvatars, PartyReadiness, usePartyPlayer } from './Watchparty';

const noTracks: SubtitleTrack[] = [];

export function WatchPlayer({ anime, episode, progress, onProgress }: { anime: Anime; episode: number; progress?: Progress; onProgress: (progress: Progress) => void }) {
  const { preferences, update } = usePreferences();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: downloads, loading: downloadsLoading } = useDownloads();
  const savedEpisodes = downloads?.downloads.filter(job => job.anime.id === anime.id && job.audio === preferences.audio).flatMap(job => job.episodes).filter(episode => episode.status === 'complete') || [];
  const downloaded = savedEpisodes.find(saved => saved.number === episode)?.playback;
  const availability = useAvailability(anime.id, !downloadsLoading && !downloaded);
  const [provider, setProvider] = useState<ProviderPreference>(preferences.provider);
  const audio = preferences.audio;
  const [serverId, setServerId] = useState('');
  const [servers, setServers] = useState<ProviderServer[]>([]);
  const [playback, setPlayback] = useState<PlaybackResponse | null>(null);
  const [localSource, setLocalSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [revealedSource, setRevealedSource] = useState('');
  const [error, setError] = useState('');
  const [resumeNote, setResumeNote] = useState('');
  const [revision, setRevision] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const lastSave = useRef(0);
  const localUrl = useRef('');
  const episodes = [...new Set([...savedEpisodes.map(episode => episode.number), ...availableEpisodes(availability.data, audio, preferences.providerFallback ? 'auto' : provider)])].sort((a, b) => a - b);
  const requestedEpisodes = availableEpisodes(availability.data, audio, provider);
  const playable = !!downloaded || (preferences.providerFallback ? episodes : requestedEpisodes).includes(episode);
  const effectivePlayback = downloaded || playback;
  const source: PlaybackSource | undefined = localSource ? { url: localSource, type: 'mp4' } : effectivePlayback?.sources[0];
  useDiscordPresence(video, anime, episode, source?.url);
  const party = usePartyPlayer(video, anime.id, episode, source?.url, Boolean(localSource));
  const localEpisodes = anime.episodes ? Array.from({ length: Math.min(anime.episodes, 100000) }, (_, index) => index + 1) : [episode];
  const navigation = localSource || !episodes.length ? localEpisodes : episodes;
  const nextEpisode = navigation.find(number => number > episode);
  const episodeThumbnail = typeof location.state?.episodeThumbnail === 'string' ? location.state.episodeThumbnail : anime.episodeArtwork?.find(entry => entry.number === episode)?.thumbnail;
  const nextArtwork = anime.episodeArtwork?.find(entry => entry.number === nextEpisode);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.watch-content');
    // Safari can ignore CSS overscroll rules for browser history gestures.
    const preventPageSwipe = (event: TouchEvent) => {
      if (event.target instanceof Element && event.target.closest('.cinema-panel,input[type="range"]')) return;
      if (event.cancelable) event.preventDefault();
    };
    const preventEdgeSwipe = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      if (event.target instanceof Element && event.target.closest('a,button,input,select,.cinema-panel')) return;
      const x = event.touches[0].clientX;
      if (x <= 24 || x >= innerWidth - 24) preventPageSwipe(event);
    };
    root?.addEventListener('touchmove', preventPageSwipe, { passive: false });
    root?.addEventListener('touchstart', preventEdgeSwipe, { passive: false });
    return () => {
      root?.removeEventListener('touchmove', preventPageSwipe);
      root?.removeEventListener('touchstart', preventEdgeSwipe);
    };
  }, []);
  useEffect(() => () => { if (localUrl.current) URL.revokeObjectURL(localUrl.current); }, []);
  useEffect(() => {
    if (localSource || downloaded || downloadsLoading || availability.loading || !playable) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(''); setPlayback(null);
    resolvePlayback({ animeId: anime.id, episode, provider, providerOrder: preferences.providerOrder, audio, fallback: preferences.providerFallback, ...(serverId ? { serverId } : {}) }, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setPlayback(result); setBuffering(true); } })
      .catch(() => { if (!controller.signal.aborted) setError('No playable source found. Try another server.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [anime.id, episode, provider, audio, serverId, preferences.providerFallback, preferences.providerOrder, playable, availability.loading, localSource, revision, downloaded?.sources[0]?.url, downloadsLoading]);

  const selectedProvider = provider === 'auto' ? playback?.provider : provider;
  useEffect(() => {
    setServers([]);
    if (!selectedProvider || localSource || downloaded) return;
    const controller = new AbortController();
    fetchServers(anime.id, episode, selectedProvider, audio, controller.signal).then(result => { if (!controller.signal.aborted) setServers(result.servers); }).catch(() => {});
    return () => controller.abort();
  }, [anime.id, episode, selectedProvider, audio, localSource, !!downloaded]);



  function save(force = false, player = video.current) {
    if (!player || !Number.isFinite(player.duration) || player.duration <= 0 || (!force && Date.now() - lastSave.current < 5000)) return;
    lastSave.current = Date.now();
    onProgress({ anime, episode, time: player.currentTime, duration: player.duration, updated: Date.now() });
  }

  async function loaded() {
    setResumeNote('');
    const player = video.current;
    if (!player) return;
    if (await party.ready()) return;
    if (video.current !== player) return;
    if (progress?.episode === episode) {
      if (canResume(progress.time, progress.duration, player.duration)) player.currentTime = progress.time;
      else if (progress.time > 0 && progress.time < progress.duration * 0.95) setResumeNote('This source has a different runtime. Saved progress was not applied.');
    }
    if (location.state?.autoplay) void player.play().catch(failure => {
      if (video.current === player && failure?.name !== 'AbortError') setResumeNote('Press Play to start playback.');
    });
  }

  function chooseProvider(value: ProviderPreference) {
    save(true); setPlayback(null); setError(''); setServerId(''); setProvider(value); setRevision(value => value + 1);
  }

  function chooseAudio(value: AudioPreference) {
    save(true); setPlayback(null); setError(''); setServerId(''); update({ audio: value });
  }

  const audioAvailable = Object.fromEntries((['sub', 'dub'] as const).map(value => [value,
    !localSource && (!!downloads?.downloads.some(job => job.anime.id === anime.id && job.audio === value && job.episodes.some(saved => saved.number === episode && saved.status === 'complete')) || !availability.loading && availableEpisodes(availability.data, value, preferences.providerFallback ? 'auto' : provider).includes(episode)),
  ])) as Record<AudioPreference, boolean>;

  const findingSource = !source && (downloadsLoading || availability.loading || loading || (playable && !effectivePlayback && !error && !availability.error));
  const playerError = error || party.error || (!localSource && availability.error ? 'Sources could not be checked. Try another provider.' : '');
  function reportError(message: string) { video.current?.pause(); setBuffering(false); setError(message); }
  return <div className="watch-content" aria-label="Episode player">
    <header className="cinema-header"><Link viewTransition={!window.matchMedia('(pointer: coarse)').matches && !preferences.reduceMotion && !window.matchMedia('(prefers-reduced-motion: reduce)').matches} className="cinema-icon" aria-label="Back to series" to={`/anime/${anime.id}`}><ArrowLeft aria-hidden="true" /></Link><div><h1>{anime.title}</h1><p>Episode {episode}</p></div></header>
    <div className="player-shell">
      <img className={`player-backdrop${(source && revealedSource === source.url) || playerError || (!source && !findingSource) ? ' is-revealed' : ''}`} src={episodeThumbnail || anime.banner || anime.cover} onError={event => { const fallback = anime.banner || anime.cover; if (event.currentTarget.getAttribute('src') !== fallback) event.currentTarget.src = fallback; }} alt="" aria-hidden="true" />
      {source ? <Player key={source.url} source={source} videoRef={video} label={`${anime.title}, episode ${episode}`} onSave={save} onReady={loaded} onFirstFrame={() => setRevealedSource(source.url)} onBuffering={setBuffering} onClick={() => togglePlayback(video, reportError)} onError={reportError} /> : null}
      {(playerError || (!source && !findingSource)) && <div className="player-empty" role={playerError ? 'alert' : 'status'}><img className="source-mascot" src="/error-mascot.png" alt="" width="180" height="188" /><p className="source-status">{playerError || 'no source could be found...'}</p>{!localSource && availability.error && <button onClick={() => { setError(''); availability.retry(); }}>Retry source check</button>}</div>}
      {(!playerError && (party.waiting || (!source && findingSource) || (source && buffering && !error))) && <div className="player-loading" role="status" aria-label={source ? 'Loading video' : 'Finding video source'}><span className="buffer-spinner" />{party.waiting && <PartyReadiness members={party.status.members} ready={party.status.loading?.ready || []} />}<span className="sr-only">{source ? 'Loading video' : 'Finding video source'}</span></div>}
      <input hidden type="file" accept="video/*,.mkv" aria-label="Choose a local video" onChange={event => {
        const file = event.target.files?.[0];
        if (file) { if (party.status.room) party.leave(); party.advertise(null); video.current?.pause(); save(true); if (localUrl.current) URL.revokeObjectURL(localUrl.current); localUrl.current = URL.createObjectURL(file); setLocalSource(localUrl.current); setError(''); setBuffering(true); }
        event.target.value = '';
      }} />
    </div>
    {resumeNote && <p className="data-note" role="status">{resumeNote}</p>}
    
    <CinemaControls partyControls={party.status.active || party.status.members.length > 1 ? <PartyAvatars members={party.status.members} onLeave={party.leave} /> : undefined} intro={effectivePlayback?.intro} outro={effectivePlayback?.outro} onError={reportError} nextEpisode={nextEpisode ? { number: nextEpisode, title: nextArtwork?.title, image: nextArtwork?.thumbnail || anime.banner || anime.cover, series: anime.title } : undefined} audio={audio} audioAvailable={audioAvailable} onAudioChange={chooseAudio} videoRef={video} sourceUrl={source?.url} sourceType={source?.type} tracks={localSource ? noTracks : effectivePlayback?.subtitles || noTracks} animeId={anime.id} episode={episode} local={Boolean(localSource)} next={nextEpisode ? () => { save(true); party.next(nextEpisode); navigate(`/watch/${anime.id}/${nextEpisode}`, { state: { autoplay: true } }); } : undefined}>
    <div className="source-controls" aria-label="Playback sources">
      <label>Provider<select disabled={Boolean(localSource || downloaded)} value={provider} onChange={event => chooseProvider(event.target.value as ProviderPreference)}><option value="auto">Automatic</option>{preferences.providerOrder.map(id => { const available = availableEpisodes(availability.data, audio, id).includes(episode); return <option key={id} value={id} disabled={!available}>{providerNames[id]}{availability.loading ? ' (Checking...)' : !available ? ' (Unavailable)' : ''}</option>; })}</select></label>
      <label>Server<select disabled={!servers.length || Boolean(localSource)} value={serverId || playback?.server.id || ''} onChange={event => { save(true); setError(''); setPlayback(null); if (provider === 'auto' && selectedProvider) setProvider(selectedProvider); setServerId(event.target.value); }}><option value="">Automatic</option>{servers.map(server => <option key={server.id} value={server.id}>{server.name}</option>)}</select></label>
    </div>

    </CinemaControls>
  </div>;
}
