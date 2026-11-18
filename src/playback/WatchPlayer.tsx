import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CinemaControls } from './CinemaControls';
import { fetchServers, providerNames, resolvePlayback } from '../api';
import type { SubtitleTrack } from '../../shared/api';
import type { Anime } from '../catalog';
import type { Progress } from '../library';
import { usePreferences } from '../PreferencesContext';
import { providerIds, type AudioPreference, type PlaybackResponse, type PlaybackSource, type ProviderPreference, type ProviderServer } from '../../shared/api';
import { availableEpisodes, useAvailability } from './availability';
import { canResume, Player } from './Player';
import './playback.css';
import { useDiscordPresence } from './discord';

const noTracks: SubtitleTrack[] = [];

export function WatchPlayer({ anime, episode, progress, onProgress }: { anime: Anime; episode: number; progress?: Progress; onProgress: (progress: Progress) => void }) {
  const { preferences, update } = usePreferences();
  const navigate = useNavigate();
  const location = useLocation();
  const availability = useAvailability(anime.id);
  const [provider, setProvider] = useState<ProviderPreference>(preferences.provider);
  const audio = preferences.audio;
  const [serverId, setServerId] = useState('');
  const [servers, setServers] = useState<ProviderServer[]>([]);
  const [playback, setPlayback] = useState<PlaybackResponse | null>(null);
  const [localSource, setLocalSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState('');
  const [resumeNote, setResumeNote] = useState('');
  const [revision, setRevision] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const lastSave = useRef(0);
  const localUrl = useRef('');
  const episodes = availableEpisodes(availability.data, audio, preferences.providerFallback ? 'auto' : provider);
  const requestedEpisodes = availableEpisodes(availability.data, audio, provider);
  const playable = (preferences.providerFallback ? episodes : requestedEpisodes).includes(episode);
  const source: PlaybackSource | undefined = localSource ? { url: localSource, type: 'mp4' } : playback?.sources[0];
  useDiscordPresence(video, anime, episode, source?.url);
  const localEpisodes = anime.episodes ? Array.from({ length: Math.min(anime.episodes, 100000) }, (_, index) => index + 1) : [episode];
  const navigation = localSource || !episodes.length ? localEpisodes : episodes;
  const nextEpisode = navigation.find(number => number > episode);
  const nextArtwork = anime.episodeArtwork?.find(entry => entry.number === nextEpisode);

  useEffect(() => () => { if (localUrl.current) URL.revokeObjectURL(localUrl.current); }, []);
  useEffect(() => {
    if (localSource || availability.loading || !playable) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError(''); setPlayback(null);
    resolvePlayback({ animeId: anime.id, episode, provider, audio, fallback: preferences.providerFallback, ...(serverId ? { serverId } : {}) }, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setPlayback(result); setBuffering(true); } })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No playable source was found.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [anime.id, episode, provider, audio, serverId, preferences.providerFallback, playable, availability.loading, localSource, revision]);

  const selectedProvider = provider === 'auto' ? playback?.provider : provider;
  useEffect(() => {
    setServers([]);
    if (!selectedProvider || localSource) return;
    const controller = new AbortController();
    fetchServers(anime.id, episode, selectedProvider, audio, controller.signal).then(result => { if (!controller.signal.aborted) setServers(result.servers); }).catch(() => {});
    return () => controller.abort();
  }, [anime.id, episode, selectedProvider, audio, localSource]);



  function save(force = false, player = video.current) {
    if (!player || !Number.isFinite(player.duration) || player.duration <= 0 || (!force && Date.now() - lastSave.current < 5000)) return;
    lastSave.current = Date.now();
    onProgress({ anime, episode, time: player.currentTime, duration: player.duration, updated: Date.now() });
  }

  function loaded() {
    setResumeNote('');
    const player = video.current;
    if (player && location.state?.autoplay) void player.play().catch(() => setResumeNote('Press Play to start the next episode.'));
    if (!player || !progress || progress.episode !== episode) return;
    if (canResume(progress.time, progress.duration, player.duration)) player.currentTime = progress.time;
    else if (progress.time > 0 && progress.time < progress.duration * 0.95) setResumeNote('This source has a different runtime. Saved progress was not applied.');
  }

  function chooseProvider(value: ProviderPreference) {
    save(true); setPlayback(null); setError(''); setServerId(''); setProvider(value); setRevision(value => value + 1);
  }

  function chooseAudio(value: AudioPreference) {
    save(true); setPlayback(null); setError(''); setServerId(''); update({ audio: value });
  }

  const audioAvailable = Object.fromEntries((['sub', 'dub'] as const).map(value => [value,
    !localSource && !availability.loading && availableEpisodes(availability.data, value, preferences.providerFallback ? 'auto' : provider).includes(episode),
  ])) as Record<AudioPreference, boolean>;

  function retry() {
    setError('');
    if (!playable) availability.retry();
    else setRevision(value => value + 1);
  }

  const findingSource = availability.loading || loading || (playable && !playback && !error && !availability.error);
  const providerErrors = availability.data?.providers.filter(entry => entry.status === 'error' || entry.status === 'ambiguous') ?? [];
  return <div className="watch-content" aria-label="Episode player">
    <header className="cinema-header"><Link className="cinema-icon" aria-label="Back to series" to={`/anime/${anime.id}`}><ArrowLeft aria-hidden="true" /></Link><div><h1>{anime.title}</h1><p>Episode {episode}</p></div></header>
    <div className="player-shell">
      {source ? <Player key={source.url} source={source} videoRef={video} label={`${anime.title}, episode ${episode}`} onSave={save} onReady={loaded} onBuffering={setBuffering} onClick={() => { const player = video.current; if (player) { if (player.paused) void player.play().catch(() => setError('Playback could not start. Try another source.')); else player.pause(); } }} onError={message => { setBuffering(false); setError(message); }} /> : !findingSource && <div className="player-empty" role="status"><img className="source-mascot" src="/error-mascot.png" alt="" width="180" height="188" /><p className="source-status">no source could be found...</p></div>}
      {((!source && findingSource) || (source && buffering && !error)) && <div className="player-loading" role="status" aria-label={source ? 'Loading video' : 'Finding video source'}><span className="buffer-spinner" /><span className="sr-only">{source ? 'Loading video' : 'Finding video source'}</span></div>}
      <input ref={input} className="sr-only" type="file" accept="video/*,.mkv" aria-label="Choose a local video" onChange={event => {
        const file = event.target.files?.[0];
        if (file) { video.current?.pause(); save(true); if (localUrl.current) URL.revokeObjectURL(localUrl.current); localUrl.current = URL.createObjectURL(file); setLocalSource(localUrl.current); setError(''); setBuffering(true); }
        event.target.value = '';
      }} />
    </div>
    {(error || (!localSource && availability.error)) && <div className="notice" role="alert"><p>{error || availability.error}</p><button onClick={localSource ? () => input.current?.click() : retry}>{localSource ? 'Choose another file' : 'Retry'}</button></div>}
    {!availability.loading && !playable && !localSource && !error && !availability.error && <div className="notice" role="status"><p>{providerErrors.length ? 'Some providers could not be checked. Try another provider or retry.' : 'No matching episodes found. Try another audio option, provider, or local file.'}</p><button onClick={retry}>Retry</button></div>}
    {resumeNote && <p className="data-note" role="status">{resumeNote}</p>}
    
    <CinemaControls nextEpisode={nextEpisode ? { number: nextEpisode, title: nextArtwork?.title, image: nextArtwork?.thumbnail || anime.banner || anime.cover, series: anime.title } : undefined} audio={audio} audioAvailable={audioAvailable} onAudioChange={chooseAudio} videoRef={video} sourceUrl={source?.url} tracks={localSource ? noTracks : playback?.subtitles || noTracks} animeId={anime.id} episode={episode} local={Boolean(localSource)} next={nextEpisode ? () => { save(true); navigate(`/watch/${anime.id}/${nextEpisode}`, { state: { autoplay: true } }); } : undefined}>
    <div className="source-controls" aria-label="Playback sources">
      <label>Provider<select disabled={Boolean(localSource)} value={provider} onChange={event => chooseProvider(event.target.value as ProviderPreference)}><option value="auto">Automatic</option>{providerIds.map(id => { const available = availableEpisodes(availability.data, audio, id).includes(episode); return <option key={id} value={id} disabled={!available}>{providerNames[id]}{availability.loading ? ' (Checking...)' : !available ? ' (Unavailable)' : ''}</option>; })}</select></label>
      <label>Server<select disabled={!servers.length || Boolean(localSource)} value={serverId || playback?.server.id || ''} onChange={event => { save(true); setPlayback(null); if (provider === 'auto' && selectedProvider) setProvider(selectedProvider); setServerId(event.target.value); }}><option value="">Automatic</option>{servers.map(server => <option key={server.id} value={server.id}>{server.name}</option>)}</select></label>
    </div>

    </CinemaControls>
  </div>;
}
