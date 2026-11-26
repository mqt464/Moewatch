import { SeriesMetadata } from './SeriesMetadata';
import { Link, useMotionAllowed } from './navigation';
import { ContinueCard } from './ContinueCard';
import { EditableHomeRow, HomeEditingBar, homeRowNames } from './HomeEditing';
import { moveHomeRow, type HomeRowId } from './homeLayout';
import { preferencesKey } from './preferences';
import { Discussions } from './Discussions';
import { apiRequest } from './api';
import { keyboardInput, usePresence } from './motion';
import { SeriesFacts } from './SeriesFacts';
import './pwa';
import { connectSharedStorage } from './sharedStorage';
import { checkDesktopUpdates } from './settings/DesktopUpdates';
void checkDesktopUpdates().catch(() => {});
import { DocumentScrollbar } from './DocumentScrollbar';
import React, { Component, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, NavLink as RouterNavLink, Outlet, useLocation, useNavigate, useViewTransitionState, useParams, useSearchParams, type NavLinkProps } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Info, Play, Search, X } from 'lucide-react';
import { Skeleton, SkeletonBox, SkulletProvider } from 'skullet/react';
import { cachedAnime, curated, fetchAnime, fetchCatalog, type Anime } from './catalog';
import { heroFraming } from './artwork';
import { featuredHero } from './featured';
import { HeroMetadata } from './HeroMetadata';
import { emptyLibrary, episodeNumber, libraryStatus, type Library, type Progress } from './library';
import { AccountProvider, useAccount } from './AccountContext';
import './styles.css';
import { PreferencesProvider, usePreferences } from './PreferencesContext';
import { ProfileMenu } from './ProfileMenu';
import { ListStatus } from './ListStatus';
import { FavouriteButton } from './FavouriteButton';
import { SettingsPage } from './settings/SettingsPage';
import { ScrollArea, ScrollFades } from './ScrollArea';
import { WatchPlayer } from './playback/WatchPlayer';
import { WatchpartyProvider } from './playback/Watchparty';
import { availableEpisodes, useAvailability } from './playback/availability';
import { DownloadsProvider, useDownloads } from './downloads/DownloadsContext';
import { downloadedTitles } from './downloadLibrary';
import { DownloadButton, DownloadsPopover } from './downloads/Downloads';
import './motion.css';

type LibraryContextValue = { library: Library; toggle: (anime: Anime) => void; update: (progress: Progress) => void };
const LibraryContext = React.createContext<LibraryContextValue>({ library: emptyLibrary, toggle: () => {}, update: () => {} });
const useLibrary = () => React.useContext(LibraryContext);

function NavLink(props: NavLinkProps) {
  return <RouterNavLink {...props} viewTransition={useMotionAllowed()} />;
}

function Artwork({ src, alt = '', className = '', eager = false, fallback }: { src: string; alt?: string; className?: string; eager?: boolean; fallback?: React.ReactNode }) {
  const image = useRef<HTMLImageElement>(null);
  const [loadedSource, setLoadedSource] = useState('');
  const [failedSource, setFailedSource] = useState<string | null>(null);
  function revealImage() {
    const current = image.current;
    if (!current?.complete || !current.naturalWidth) return;
    current.decode().catch(() => {}).then(() => { if (image.current === current) setLoadedSource(src); });
  }
  useEffect(() => { revealImage(); }, [src]);
  const failed = failedSource === src || !src;
  const loading = !failed && loadedSource !== src;
  return <div className={`artwork-frame ${className ? `${className}-frame` : ''}`} aria-busy={loading || undefined}>{failed ? fallback ?? <span className="art-fallback" role="img" aria-label={alt || 'Artwork unavailable'}></span> : <img key={src} draggable={false} ref={image} className={`artwork ${loadedSource === src ? 'is-ready' : 'is-loading'} ${className}`} src={src} alt={alt} width={600} height={900} fetchPriority={eager ? 'high' : undefined} loading={eager ? 'eager' : 'lazy'} decoding="async" onLoad={revealImage} onError={() => setFailedSource(src)} />}{loading && <SkeletonBox className="artwork-loading" width="100%" height="100%" radius="inherit" />}</div>;
}

function Header() {
  const { data } = useDownloads();
  const hasDownloads = downloadedTitles(data?.downloads ?? []).length > 0;
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="header">
      <Link to="/" className="brand" aria-label="Moewatch home">
        <img src="/favicon.png" alt="" width="36" height="36" />
        <span>moe<span className="brand-light">watch</span><span className="brand-dot">.</span></span>
      </Link>
      <nav aria-label="Main navigation">
        <NavLink to="/" end>Discover</NavLink>
        <NavLink to="/browse">Search</NavLink>
        <NavLink to="/list">My List</NavLink>
        {hasDownloads && <NavLink to="/library">Library</NavLink>}
      </nav>
      <div className="header-actions"><DownloadsPopover /><ProfileMenu /></div>
    </header>

  </>;
}

function Poster({ anime, showYear = false, watching = false, progress }: { anime: Anime; showYear?: boolean; watching?: boolean; progress?: Progress }) {
  const { preferences } = usePreferences();
  const percent = progress ? Math.min(100, Math.max(0, Math.round(progress.time / progress.duration * 100))) : 0;
  return <article className="poster">
    <Link to={'/anime/' + anime.id} className="poster-link">
      <div className="poster-image"><Artwork src={anime.cover} />{(watching || progress) && <div className="poster-playback">
        <span className="poster-episode">Episode {progress?.episode || 1}</span>
        <span className="progress-track" role="progressbar" aria-label={`${anime.title} episode progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></span>
      </div>}</div>
      <h3>{anime.title}</h3>
      {(showYear || preferences.showYears) && anime.year > 0 && <p>{anime.year}</p>}
    </Link>
  </article>;
}



function Carousel({ title, href, count, wide = false, children }: { title: string; href?: string; count: number; wide?: boolean; children: React.ReactNode }) {
  const { preferences } = usePreferences();
  const rail = useRef<HTMLDivElement>(null);
  const railId = useId();
  const [position, setPosition] = useState({ previous: false, next: false });
  function measure() {
    const element = rail.current;
    if (!element) return;
    setPosition({ previous: element.scrollLeft > 2, next: element.scrollLeft + element.clientWidth < element.scrollWidth - 2 });
  }
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [count]);
  function scroll(direction: number, source: 'keyboard' | 'pointer') {
    const element = rail.current;
    if (!element) return;
    const reduced = source === 'keyboard' || preferences.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollBy({ left: direction * element.clientWidth * 0.85, behavior: reduced ? 'instant' : 'smooth' });
  }
  return <section className="catalog-row" aria-label={title}>
    <div className="carousel-heading">
      <h2>{title}</h2>
      <div className="carousel-actions">
        {href && <Link className="text-link" to={href}>View all</Link>}
        {(position.previous || position.next) && <div className="carousel-controls">
          <button className="icon-button" aria-label={'Previous ' + title} aria-controls={railId} disabled={!position.previous} onClick={() => scroll(-1, keyboardInput() ? 'keyboard' : 'pointer')}><ChevronLeft aria-hidden="true" size={19} /></button>
          <button className="icon-button" aria-label={'Next ' + title} aria-controls={railId} disabled={!position.next} onClick={() => scroll(1, keyboardInput() ? 'keyboard' : 'pointer')}><ChevronRight aria-hidden="true" size={19} /></button>
        </div>}
      </div>
    </div>
    <ScrollArea ref={rail} id={railId} className={'carousel-rail' + (wide ? ' landscape-rail' : '')} tabIndex={0} role="group" aria-label={title + ' carousel'} onScroll={measure} onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); scroll(event.key === 'ArrowRight' ? 1 : -1, 'keyboard'); }
    }}>{children}</ScrollArea>
  </section>;
}

const homeGenres = ['Action', 'Adventure', 'Slice of Life'];

function Recommended() {
  const { user, library, loading, lastSynced } = useAccount();
  if (!user) return null;
  return <RecommendedResults key={user.id} userId={user.id} library={library} accountLoading={loading} lastSynced={lastSynced} />;
}

function RecommendedResults({ userId, library, accountLoading, lastSynced }: { userId: number; library: Library; accountLoading: boolean; lastSynced: number | null }) {
  const seeds = [...new Set([
    ...library.saved.filter(anime => ['COMPLETED', 'CURRENT', 'REPEATING'].includes(libraryStatus(library, anime) ?? '')).map(anime => anime.id),
    ...library.progress.filter(item => libraryStatus(library, item.anime) !== 'DROPPED').map(item => item.anime.id),
  ])].slice(0, 10).join(',');
  const [titles, setTitles] = useState<Anime[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!userId || accountLoading) return;
    const controller = new AbortController();
    setError(false);
    apiRequest<{ anime: Anime[] }>(`/account/recommendations?seeds=${seeds}`, { headers: { 'X-Moewatch-Account': String(userId) }, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setTitles(result.anime); })
      .catch(() => { if (!controller.signal.aborted) { setTitles(current => current ?? []); setError(true); } });
    return () => controller.abort();
  }, [userId, seeds, accountLoading, lastSynced, retry]);
  const excluded = new Set([...library.saved.map(anime => anime.id), ...library.progress.map(item => item.anime.id)]);
  const items = titles?.filter(anime => !excluded.has(anime.id)).slice(0, 20);
  if ((!items?.length && error) || items?.length === 0) return <section className="recommended-empty" aria-labelledby="recommended-heading">
    <h2 id="recommended-heading">Recommended</h2>
    <p>{error ? 'AniList recommendations are unavailable right now.' : 'Favourite or watch anime on AniList to discover more shows like them.'}</p>
    {error && <button className="text-link" onClick={() => setRetry(value => value + 1)}>Retry</button>}
  </section>;
  return <Skeleton id="home-recommended" data={items} sample={curated} label="Loading AniList recommendations">
    {items => <Carousel title="Recommended" count={items.length}>{items.map(anime => <Poster key={anime.id} anime={anime} />)}</Carousel>}
  </Skeleton>;
}

function Home() {
  const location = useLocation();
  const navigate = useNavigate();
  const { preferences, update } = usePreferences();
  const [editing, setEditing] = useState(location.state?.editHome === true);
  const [draft, setDraft] = useState(preferences.homeLayout);
  const [saveError, setSaveError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const layout = editing ? draft : preferences.homeLayout;
  useEffect(() => {
    if (location.state?.editHome) {
      setDraft(preferences.homeLayout);
      setEditing(true);
      navigate('/', { replace: true, state: null });
    }
  }, [location.state, navigate, preferences.homeLayout]);
  function moveRow(id: HomeRowId, target: HomeRowId) {
    const order = moveHomeRow(draft.order, id, target);
    setDraft({ ...draft, order });
    setAnnouncement(homeRowNames[id] + ' moved to position ' + (order.indexOf(id) + 1));
  }
  function finish(save: boolean) {
    if (save) {
      try { localStorage.setItem(preferencesKey, JSON.stringify({ ...preferences, homeLayout: draft })); }
      catch { setSaveError('Layout could not be saved. Try again.'); return; }
      update({ homeLayout: draft });
    }
    setSaveError('');
    setEditing(false);
  }
  const [featured, setFeatured] = useState(featuredHero.current);
  const { library } = useLibrary();
  const [titles, setTitles] = useState<Anime[] | null>(null);
  const [live, setLive] = useState(false);
  const [categories, setCategories] = useState<Record<string, Anime[]>>({});
  const [offline, setOffline] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setOffline(false);
    [undefined, ...homeGenres].forEach(genre => {
      const fallback = genre ? curated.filter(anime => anime.genres.includes(genre)) : curated;
      fetchCatalog({ genre, signal: controller.signal }).then(results => {
        if (controller.signal.aborted) return;
        if (genre) setCategories(current => ({ ...current, [genre]: results }));
        else { setTitles(results.length ? results : curated); setLive(results.length > 0); setFeatured(featuredHero.select(results)); }
      }).catch(() => {
        if (controller.signal.aborted) return;
        if (genre) setCategories(current => ({ ...current, [genre]: fallback }));
        else { setTitles(curated); setFeatured(featuredHero.select([])); }
        setOffline(true);
      });
    });
    return () => controller.abort();
  }, [retry]);
  const watching = library.saved.filter(anime => libraryStatus(library, anime) === 'CURRENT');
  const resume = library.progress.find(item => item.anime.id === featured?.id);
  function renderRow(id: HomeRowId): React.ReactNode {
    if (id === 'watching') return watching.length ? <Carousel title="Watching" count={watching.length} wide={layout.continueStyle === 'landscape'}>{watching.map(anime => layout.continueStyle === 'landscape' ? <ContinueCard key={anime.id} anime={anime} progress={library.progress.find(item => item.anime.id === anime.id)} /> : <Poster key={anime.id} anime={anime} watching progress={library.progress.find(item => item.anime.id === anime.id)} />)}</Carousel> : editing ? <p>No watching titles</p> : null;
    if (id === 'recommended') return <><Recommended />{editing && <p className="home-edit-note">Recommendations require an AniList account.</p>}</>;
    if (id === 'trending') return <Skeleton id="home-trending" data={titles} sample={curated} label="Loading trending anime">{items => <Carousel title={live ? 'Trending' : 'Featured'} href="/browse" count={items.length}>{items.map(anime => <Poster key={anime.id} anime={anime} />)}</Carousel>}</Skeleton>;
    return <Skeleton id={'home-' + id} data={categories[id]} sample={curated.filter(anime => anime.genres.includes(id))} label={'Loading ' + id + ' anime'}>{items => items.length > 0 ? <Carousel title={id} href={'/browse?genre=' + encodeURIComponent(id)} count={items.length}>{items.map(anime => <Poster key={anime.id} anime={anime} />)}</Carousel> : editing ? <p>No titles available</p> : null}</Skeleton>;
  }
  return <>
    {(!layout.hero || editing) && <h1 className="sr-only">{editing ? 'Edit homepage' : 'Discover'}</h1>}
    {layout.hero && <Skeleton id="home-hero" data={featured} sample={curated[0]} label="Loading featured anime">{featured =>
    <div className="home-hero" style={heroFraming(featured.id)}>
    <div className="hero-ambience" aria-hidden="true" style={{ backgroundImage: `url(${JSON.stringify(featured.banner || featured.cover)})` }} />
    <section className="hero" aria-label="Featured anime" style={heroFraming(featured.id)}>
      <Artwork className="hero-art" src={featured.banner || featured.cover} eager />
      <div className="hero-shade" />
      <div className="hero-content">
        <h1>{featured.title}</h1>
        <HeroMetadata anime={featured} />
        <div className="hero-actions">
          <Link className="button primary" to={'/watch/' + featured.id + '/' + (resume?.episode || 1)}><Play aria-hidden="true" size={17} fill="currentColor" />{resume ? 'Resume' : 'Watch'}</Link>
          <Link className="button secondary" to={'/anime/' + featured.id}>Details</Link>
          <ListStatus anime={featured} compact />
        </div>
      </div>
    </section>
    </div>
    }</Skeleton>}
    <div className={"content-wrap home-content" + (editing ? " home-editing" : "")}>
      {offline && <div className="notice" role="status"><Info aria-hidden="true" size={17} /><p>AniList updates unavailable. Showing cached titles where needed.</p><button onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
      {layout.order.map(id => editing ? <EditableHomeRow key={id} id={id} layout={layout} change={setDraft} move={moveRow}>{renderRow(id)}</EditableHomeRow> : !layout.hidden.includes(id) && <React.Fragment key={id}>{renderRow(id)}</React.Fragment>)}
      {editing && <><span className="sr-only" role="status">{announcement}</span><HomeEditingBar layout={draft} change={setDraft} save={() => finish(true)} cancel={() => finish(false)} error={saveError} /></>}
    </div>
  </>;
}

function Browse() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') || '';
  const genre = params.get('genre') || '';
  const [input, setInput] = useState(search);
  const [items, setItems] = useState<Anime[]>([]);
  const [resultQuery, setResultQuery] = useState<{ search: string; genre: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => setInput(search), [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchCatalog({ search: search || undefined, genre: genre || undefined, signal: controller.signal }).then(results => {
      if (controller.signal.aborted) return;
      setOffline(false);
      setItems(results);
      setResultQuery({ search, genre });
    }).catch(() => {
      if (controller.signal.aborted) return;
      setOffline(true);
      setItems(curated.filter(anime => (!search || `${anime.title} ${anime.romaji}`.toLowerCase().includes(search.toLowerCase())) && (!genre || anime.genres.includes(genre))));
      setResultQuery({ search, genre });
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [search, genre, retry]);
  const pending = loading || resultQuery?.search !== search || resultQuery?.genre !== genre;
  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }
  return <div className="content-wrap page-content"><h1 className="page-title">Search</h1><form className="search-form" role="search" onSubmit={event => { event.preventDefault(); updateParam('search', input.trim()); }}><Search aria-hidden="true" size={21} /><label className="sr-only" htmlFor="anime-search">Search anime</label><input id="anime-search" name="search" type="search" autoComplete="off" placeholder="Search anime…" value={input} onChange={event => setInput(event.target.value)} autoFocus={params.has('search') && window.matchMedia('(min-width: 761px)').matches} />{input && <button type="button" className="icon-button" aria-label="Clear search" onClick={() => { setInput(''); updateParam('search', ''); }}><X aria-hidden="true" size={18} /></button>}<button type="submit" className="button primary">Search</button></form><div className="browse-toolbar"><div className="genre-options" aria-label="Filter by genre">{['', 'Action', 'Adventure', 'Drama', 'Fantasy', 'Romance', 'Slice of Life', 'Sci-Fi'].map(value => <button key={value} className={genre === value ? 'selected' : ''} aria-pressed={genre === value} onClick={() => updateParam('genre', value)}>{value || 'All genres'}</button>)}</div></div><div className="results-heading"><h2>{resultQuery?.search ? `Results for “${resultQuery.search}”` : resultQuery?.genre || 'Anime'}</h2><span role="status" aria-live="polite">{pending ? 'Loading…' : `${items.length} titles${offline ? ' · cached' : ''}`}</span></div>{offline && <div className="notice" role="status"><Info aria-hidden="true" size={18} /><p>AniList unavailable. Showing cached titles.</p><button onClick={() => setRetry(value => value + 1)}>Retry</button></div>}<div className="search-results" aria-busy={pending}><Skeleton id="browse-results" data={items.length || !pending ? items : null} sample={curated.slice(0, 6)} loading={pending && !resultQuery} label="Loading anime">{results => results.length ? <div className="poster-grid">{results.map(anime => <Poster key={anime.id} anime={anime} showYear />)}</div> : <Empty title="No results" action="Reset filters" to="/browse" />}</Skeleton></div></div>;
}

function DownloadLibrary() {
  const { data, loading, error } = useDownloads();
  const { library } = useLibrary();
  const titles = downloadedTitles(data?.downloads ?? []);
  return <div className="content-wrap page-content">
    <h1 className="page-title">Library</h1>
    {loading ? <p role="status">Loading downloads…</p> : titles.length ? <div className="poster-grid saved-grid">{titles.map(anime => <Poster key={anime.id} anime={anime} progress={library.progress.find(item => item.anime.id === anime.id)} />)}</div> : <Empty title="No downloaded anime" action="Search anime" to="/browse" />}
    {error && <p role="alert">{error}</p>}
  </div>;
}

function MyList() {
  const { library } = useLibrary();
  const groups = [
    { title: 'Watching', statuses: ['CURRENT', 'REPEATING'] },
    { title: 'Paused', statuses: ['PAUSED'] },
    { title: 'Planning', statuses: ['PLANNING'] },
    { title: 'Completed', statuses: ['COMPLETED'] },
    { title: 'Dropped', statuses: ['DROPPED'] },
  ];
  return <div className="content-wrap page-content">
    <h1 className="page-title">My List</h1>
    {library.saved.length ? groups.map(group => {
      const titles = library.saved.filter(anime => group.statuses.includes(libraryStatus(library, anime) ?? ''));
      return titles.length > 0 && <section className="library-group" key={group.title} aria-labelledby={`list-${group.title.toLowerCase()}`}>
        <h2 id={`list-${group.title.toLowerCase()}`}>{group.title}</h2>
        <div className="poster-grid saved-grid">{titles.map(anime => <div className="saved-poster" key={anime.id}><Poster anime={anime} progress={library.progress.find(item => item.anime.id === anime.id)} /><ListStatus anime={anime} compact /></div>)}</div>
      </section>;
    }) : <Empty title="No saved anime" action="Search anime" to="/browse" />}
  </div>;
}

function useAnime(id: string | undefined) {
  const { library } = useLibrary();
  const { data: downloads } = useDownloads();
  const downloaded = downloads?.downloads.find(job => job.anime.id === Number(id))?.anime;
  const local = downloaded || cachedAnime(Number(id)) || [...library.saved, ...library.progress.map(item => item.anime)].find(anime => anime.id === Number(id));
  const [anime, setAnime] = useState<Anime | null>(local || null);
  const [loading, setLoading] = useState(!local);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setAnime(local || null); setLoading(!local); setError(false);
    if (!/^\d+$/.test(id || '')) { setLoading(false); return; }
    fetchAnime(Number(id), controller.signal).then(result => setAnime(result || local || null)).catch(() => { if (!controller.signal.aborted && !local) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, retry]);
  return { anime: downloaded || anime, loading: downloaded ? false : loading, error, retry: () => setRetry(value => value + 1) };
}

function Series() {
  const { id } = useParams();
  const { anime, loading, error, retry } = useAnime(id);
  return <><title>{`${anime?.title || (loading ? 'Loading anime' : error ? 'Unable to load anime' : 'Anime not found')} — Moewatch`}</title><Skeleton id="series" data={anime} sample={curated[0]} loading={loading} label="Loading series" error={!loading && !anime ? <ErrorPage title={error ? 'Unable to load anime' : 'Anime not found'} text={error ? 'Could not reach AniList. Check your connection and try again.' : 'This title could not be found.'} retry={error ? retry : undefined} /> : undefined}>
    {anime => <SeriesContent anime={anime} />}
  </Skeleton></>;
}

function SeriesContent({ anime }: { anime: Anime }) {
  const returningToSeries = useViewTransitionState(`/anime/${anime.id}`);
  const { library } = useLibrary();
  const [tab, setTab] = useState('Episodes');
  const [episodePage, setEpisodePage] = useState(0);
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const progress = library.progress.find(item => item.anime.id === anime.id);
  const { preferences } = usePreferences();
  const availability = useAvailability(anime.id);
  const streamingEpisodes = availableEpisodes(availability.data, preferences.audio, preferences.providerFallback ? 'auto' : preferences.provider);
  const episodeNumbers = streamingEpisodes.length ? streamingEpisodes : Array.from({ length: anime.episodes || 0 }, (_, index) => index + 1);
  const count = episodeNumbers.length;
  const episodeKey = episodeNumbers.join(',');
  useEffect(() => setEpisodePage(0), [anime.id, episodeKey]);
  return <><section className="detail-hero" data-player-return={returningToSeries || undefined} style={heroFraming(anime.id)}><Artwork className="hero-art" src={anime.banner || anime.cover} eager /><Artwork className="detail-mobile-art" src={anime.cover} eager /><div className="hero-shade" /><div className="content-wrap detail-heading"><h1>{anime.title}</h1><SeriesMetadata anime={anime} /><HeroMetadata anime={anime} detailed /></div></section><div className="content-wrap detail-content"><div className="hero-actions detail-actions"><Link className="button primary" to={`/watch/${anime.id}/${progress?.episode || streamingEpisodes[0] || 1}`}><Play aria-hidden="true" size={17} fill="currentColor" />{progress ? `Resume episode ${progress.episode}` : `Watch episode ${streamingEpisodes[0] || 1}`}</Link><ListStatus anime={anime} /><FavouriteButton mediaId={anime.id} /><DownloadButton anime={anime} /></div><button className="series-details-toggle" aria-expanded={detailsExpanded} aria-controls="series-facts" onClick={() => setDetailsExpanded(!detailsExpanded)}>Synopsis<ChevronRight aria-hidden="true" size={16} /></button><SeriesFacts expanded={detailsExpanded} synopsisExpanded={synopsisExpanded}><div><p id="series-synopsis" className="synopsis-copy expanded">{!synopsisExpanded && anime.description.length > 240 ? anime.description.slice(0, 240).replace(/\s+\S*$/, '') + '\u2026' : anime.description || 'Synopsis unavailable.'}</p>{anime.description.length > 240 && <button className="synopsis-toggle" aria-expanded={synopsisExpanded} aria-controls="series-synopsis" onClick={() => setSynopsisExpanded(!synopsisExpanded)}>{synopsisExpanded ? 'Show less' : 'Show more'}</button>}</div></SeriesFacts><div className="detail-tabs" role="tablist" aria-label="Series information">{['Episodes', 'Characters', 'Related', 'Discussions'].map(value => <button role="tab" key={value} id={`tab-${value}`} aria-selected={tab === value} aria-controls="series-panel" tabIndex={tab === value ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); const tabs = ['Episodes', 'Characters', 'Related', 'Discussions']; const next = tabs[(tabs.indexOf(value) + (event.key === 'ArrowRight' ? 1 : 3)) % 4]; setTab(next); document.getElementById(`tab-${next}`)?.focus(); } }} onClick={() => setTab(value)}>{value}{value === 'Episodes' && count ? <span>{count}</span> : null}</button>)}</div><section id="series-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="series-panel">{tab === 'Episodes' ? <>{count > 24 && <select className="episode-range" aria-label="Episode range" value={episodePage} onChange={event => setEpisodePage(Number(event.target.value))}>{Array.from({ length: Math.ceil(count / 24) }, (_, index) => <option key={index} value={index}>Episodes {episodeNumbers[index * 24]}–{episodeNumbers[Math.min(count, (index + 1) * 24) - 1]}</option>)}</select>}{count ? <div className="episodes-grid">{episodeNumbers.slice(episodePage * 24, (episodePage + 1) * 24).map(episode => {
  const artwork = anime.episodeArtwork?.find(item => item.number === episode);
  const current = progress?.episode === episode;
  const percent = progress && episode < progress.episode ? 100 : current ? Math.min(100, Math.max(0, progress.time / progress.duration * 100)) : 0;
  const inProgress = current && progress.time < progress.duration;
  const remaining = inProgress ? Math.max(0, Math.ceil((progress.duration - progress.time) / 60)) : null;
  const length = current ? Math.ceil(progress.duration / 60) : anime.duration;
  return <Link to={'/watch/' + anime.id + '/' + episode} className={'episode-row' + (inProgress ? ' is-current' : '')} aria-current={inProgress ? 'true' : undefined} key={episode}>
    <div className="episode-image"><Artwork src={artwork?.thumbnail || `/api/v1/anime/${anime.id}/episodes/${episode}/thumbnail?provider=${preferences.provider}&audio=${preferences.audio}&fallback=${preferences.providerFallback}`} fallback={<span className="episode-placeholder" aria-hidden="true" />} /><div className="episode-playback"><p><span className="episode-label-number">Episode {episode}</span><span className="episode-time">{remaining !== null ? remaining + ' min left' : length ? length + ' min' : ''}</span></p><span className="episode-progress-track" role="progressbar" aria-label={'Episode ' + episode + ' progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span className="episode-progress" style={{ width: percent + '%' }} /></span></div></div>
    <div className="episode-copy"><h3>{artwork?.title || 'Episode ' + episode}</h3></div>
  </Link>;
})}</div> : <p className="muted">Episode information unavailable.</p>}</> : tab === 'Characters' ? anime.characters.length ? <div className="character-grid">{anime.characters.map(character => <article className="character" key={character.name}><Artwork src={character.image} alt={character.name} /><div><h3>{character.name}</h3><p>{character.role.toLowerCase()}</p></div></article>)}</div> : <p className="muted">Character information unavailable.</p> : tab === 'Discussions' ? <Discussions key={anime.id} mediaId={anime.id} /> : anime.related.length ? <div className="poster-grid">{anime.related.map(related => <article className="poster" key={related.id}><Link to={`/anime/${related.id}`}><div className="poster-image"><Artwork src={related.cover} alt={related.title} /></div><h3>{related.title}</h3><p>{related.relation.replaceAll('_', ' ').toLowerCase()}</p></Link></article>)}</div> : <p className="muted">No related anime.</p>}</section>{anime.episodeArtwork?.some(e => e.titleSource === 'kitsu' || e.thumbnailSource === 'kitsu' || e.titleSource === 'jikan') && <p className="data-note">Episode metadata: {anime.episodeArtwork.some(e => e.titleSource === 'kitsu' || e.thumbnailSource === 'kitsu') && <a href="https://kitsu.app" target="_blank" rel="noreferrer">Kitsu</a>}{anime.episodeArtwork.some(e => e.titleSource === 'jikan') && <>{anime.episodeArtwork.some(e => e.titleSource === 'kitsu' || e.thumbnailSource === 'kitsu') ? ' · ' : ''}<a href="https://myanimelist.net" target="_blank" rel="noreferrer">MyAnimeList</a></>}</p>}</div></>;
}

function Watch() {
  const { id, episode } = useParams();
  const { anime, loading, error, retry } = useAnime(id);
  return <><title>{`${anime ? `${anime.title} · Episode ${episodeNumber(episode, null)}` : loading ? 'Loading episode' : 'Unable to load episode'} — Moewatch`}</title><Skeleton id="watch" data={anime} sample={curated[0]} loading={loading} label="Loading episode" error={!loading && !anime ? <ErrorPage title="Unable to load episode" text="Check your connection and retry." retry={error ? retry : undefined} /> : undefined}>
    {anime => <WatchContent anime={anime} />}
  </Skeleton></>;
}

function WatchContent({ anime }: { anime: Anime }) {
  const { episode: episodeParam } = useParams();
  const { library, update } = useLibrary();
  const episode = episodeNumber(episodeParam, null);
  const progress = library.progress.find(item => item.anime.id === anime.id && item.episode === episode);
  return <WatchPlayer key={`${anime.id}:${episode}`} anime={anime} episode={episode} progress={progress} onProgress={update} />;
}

function Empty({ title, action, to }: { title: string; action: string; to: string }) {
  return <div className="empty-state">
    <h2>{title}</h2>
    <Link className="button secondary" to={to}>{action}</Link>
  </div>;
}

function ErrorPage({ title = 'Page not found', text, retry }: { title?: string; text?: string; retry?: () => void }) {
  return <div className="content-wrap error-page">
    <img src="/error-mascot.png" alt="Puzzled character" width="230" height="240" />
    <h1>{title}</h1>
    {text && <p className="error-message" role="status">{text}</p>}
    {retry ? <button className="button primary" onClick={retry}>Retry</button> : <Link className="button primary" to="/">Discover</Link>}
  </div>;
}


function App() {
  const { preferences } = usePreferences();
  const { user, library, toggle, update, storageError } = useAccount();
  const [removed, setRemoved] = useState<Anime | null>(null);
  const { mounted: toastMounted, ...toastPresence } = usePresence(Boolean(removed), false);
  const previousLibrary = useRef({ userId: user?.id, saved: library.saved });
  useEffect(() => {
    const previous = previousLibrary.current;
    previousLibrary.current = { userId: user?.id, saved: library.saved };
    if (previous.userId !== user?.id) { setRemoved(null); return; }
    const removal = previous.saved.find(anime => !library.saved.some(item => item.id === anime.id));
    if (removal) setRemoved(removal);
  }, [library.saved, user?.id]);
  const location = useLocation();
  useLayoutEffect(() => { window.scrollTo({ top: 0 }); const main = document.getElementById('main'); main?.focus({ preventScroll: true }); }, [location.pathname]);
  return <SkulletProvider mode="dark" theme={{ dark: { base: '#211b21', highlight: '#3b2d37' }, animation: preferences.reduceMotion ? 'none' : 'shimmer' }} reveal={{ hold: 0, duration: preferences.reduceMotion ? 0 : 160 }}><LibraryContext.Provider value={{ library, toggle: anime => { setRemoved(library.saved.some(item => item.id === anime.id) ? anime : null); toggle(anime); }, update }}>{!location.pathname.startsWith('/watch/') && <Header />}<main id="main" className={location.pathname.startsWith('/watch/') ? 'watch-main' : undefined} tabIndex={-1}><div className="page-scene" key={location.pathname}><Outlet /></div>{!location.pathname.startsWith('/watch/') && <DocumentScrollbar />}</main>{storageError && <div className="storage-warning" role="status">Browser storage is unavailable. Your list and history won’t survive a refresh.</div>}{toastMounted && <div {...toastPresence} className="undo-toast" role="status"><span>Removed from My List</span><button onClick={() => { if (removed && !library.saved.some(item => item.id === removed.id)) toggle(removed); setRemoved(null); }}>Undo</button><button className="icon-button" aria-label="Dismiss notification" onClick={() => setRemoved(null)}><X aria-hidden="true" size={16} /></button></div>}</LibraryContext.Provider></SkulletProvider>;
}

class ErrorBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main><ErrorPage title="Application error" text="Reload the page to retry." retry={() => window.location.reload()} /></main> : this.props.children; }
}

document.documentElement.classList.toggle('no-view-transitions', typeof document.startViewTransition !== 'function');
const router = createBrowserRouter([{ element: <WatchpartyProvider><App /></WatchpartyProvider>, children: [
  { path: '/', element: <><title>Discover — Moewatch</title><Home /></> },
  { path: '/browse', element: <><title>Search — Moewatch</title><Browse /></> },
  { path: '/list', element: <><title>My List — Moewatch</title><MyList /></> },
  { path: '/library', element: <><title>Library — Moewatch</title><DownloadLibrary /></> },
  { path: '/settings/:section?', element: <><title>Settings — Moewatch</title><SettingsPage /></> },
  { path: '/anime/:id', element: <Series /> },
  { path: '/watch/:id/:episode', element: <Watch /> },
  { path: '*', element: <><title>Page not found — Moewatch</title><ErrorPage /></> },
] }]);
void connectSharedStorage().catch(() => {}).finally(() => createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><PreferencesProvider><AccountProvider><DownloadsProvider><RouterProvider router={router} /><ScrollFades /></DownloadsProvider></AccountProvider></PreferencesProvider></ErrorBoundary></React.StrictMode>));





