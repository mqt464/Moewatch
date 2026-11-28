import { AnimeTitle } from './AnimeTitle';
import { useEffect, useState } from 'react';
import { Link } from './navigation';
import { fetchAnime, type Anime } from './catalog';
import type { Progress } from './library';

export function ContinueCard({ anime, progress: saved }: { anime: Anime; progress?: Progress }) {
  const progress = saved || { anime, episode: 1, time: 0, duration: anime.duration * 60, updated: 0 };
  const [details, setDetails] = useState(progress.anime);
  const [failedSource, setFailedSource] = useState('');
  const [loadedSource, setLoadedSource] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    if (!progress.anime.episodeArtwork?.find(item => item.number === progress.episode)?.thumbnail) {
      fetchAnime(progress.anime.id, controller.signal).then(anime => { if (anime && !controller.signal.aborted) setDetails(anime); }).catch(() => {});
    }
    return () => controller.abort();
  }, [progress.anime, progress.episode]);
  const episode = details.episodeArtwork?.find(item => item.number === progress.episode);
  const percent = Math.min(100, Math.max(0, Math.round(progress.time / (progress.duration || 1) * 100)));
  const minutes = Math.max(1, Math.ceil((progress.duration - progress.time) / 60));
  const fallback = details.banner || details.cover;
  const source = episode?.thumbnail || fallback;
  const imageSource = failedSource === source ? fallback : source;
  return <article className="continue-item">
    <Link className="continue-card" to={'/watch/' + details.id + '/' + progress.episode} state={{ autoplay: true, episodeThumbnail: imageSource }}>
      <div className="continue-art"><img src={imageSource} alt="" width={640} height={360} loading="lazy" decoding="async" style={{ opacity: loadedSource === imageSource ? 1 : 0 }} onLoad={event => { const image = event.currentTarget; image.decode().catch(() => {}).then(() => setLoadedSource(imageSource)); }} onError={() => setFailedSource(source)} />
        <div className="poster-playback">
          <div className="continue-playback-meta">
            <span className="poster-episode">Episode {progress.episode}</span>
            {progress.time > 0 && progress.time < progress.duration && <span className="continue-remaining">{minutes} {minutes === 1 ? 'minute' : 'minutes'} left</span>}
          </div>
          <span className="progress-track" role="progressbar" aria-label={details.title + ' episode progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: percent + '%' }} /></span>
        </div>
      </div>
      <h3><AnimeTitle anime={details} /></h3>
    </Link>
  </article>;
}
