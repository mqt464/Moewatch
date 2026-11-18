import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { ServerResponse } from 'node:http';
import type { Anime } from '../src/catalog';
import type { PlaybackRequest, PlaybackResponse } from '../shared/api';
import type { DownloadSeries, DownloadsResponse, DownloadQuality } from '../shared/downloads';
import { saveMedia, type DownloadReader, type SavedFile } from './download-media';
import { ApiError } from './infrastructure/errors';
import { DownloadRate } from './download-progress';

type StoredSeries = DownloadSeries & { directory: string; files: Record<string, SavedFile> };
type Dependencies = {
  stateFile?: string;
  defaultLocation?: string;
  read: DownloadReader;
  resolve: (request: PlaybackRequest, signal: AbortSignal, excluded?: string[]) => Promise<PlaybackResponse>;
  artwork: (url: string, signal: AbortSignal) => Promise<string>;
  thumbnail: (anime: Anime, episode: number, request: PlaybackRequest, signal: AbortSignal) => Promise<string | null>;
};

export class DownloadService {
  private jobs: StoredSeries[] = [];
  private location: string;
  private stateFile: string;
  private ready: Promise<void>;
  private writes = Promise.resolve();
  private active?: { id: string; controller: AbortController };
  private running = false;
  private closed = false;
  private lastFlush = 0;
  private failure?: Error;
  private transfer?: { id: string; rate: DownloadRate; remainingBytes?: number };
  private prepared?: { id: string; episode: number; controller: AbortController; started: number; promise: Promise<PlaybackResponse | undefined> };

  constructor(private dependencies: Dependencies) {
    const data = process.env.MOEWATCH_DATA_DIR || join(homedir(), '.moewatch');
    this.stateFile = dependencies.stateFile || join(data, 'downloads.json');
    this.location = dependencies.defaultLocation || join(homedir(), 'Videos', 'Moewatch');
    this.ready = this.load();
    void this.ready.then(() => this.pump()).catch(error => { this.failure = error; });
  }

  private async load() {
    try {
      const state = JSON.parse(await readFile(this.stateFile, 'utf8'));
      if (state.version !== 1 || !isAbsolute(state.location) || !Array.isArray(state.jobs)) throw new Error('Invalid downloads index');
      this.location = state.location;
      this.jobs = state.jobs;
      for (const job of this.jobs) {
        if (!/^[a-f0-9-]{36}$/.test(job.id) || !isAbsolute(job.directory) || resolve(job.directory) !== resolve(dirname(job.directory), `moewatch-${job.id}`) || !job.files || !Array.isArray(job.episodes)) throw new Error('Invalid download entry');
        if (job.episodes.some(episode => !Number.isSafeInteger(episode.number) || episode.number <= 0 || !['queued', 'downloading', 'complete', 'failed'].includes(episode.status))) throw new Error('Invalid download episode');
        for (const episode of job.episodes) if (episode.status === 'downloading') { episode.status = 'queued'; episode.progress = 0; episode.bytes = 0; }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Could not read the downloads index. Existing files have been preserved.');
    }
  }

  private async check() { await this.ready; if (this.failure) throw this.failure; }

  private persist() {
    const text = JSON.stringify({ version: 1, location: this.location, jobs: this.jobs });
    const write = this.writes.then(async () => {
      await mkdir(dirname(this.stateFile), { recursive: true });
      await writeFile(`${this.stateFile}.tmp`, text);
      for (let attempt = 0; ; attempt++) {
        try { await rename(`${this.stateFile}.tmp`, this.stateFile); break; }
        catch (error) {
          if (attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
          await delay(50);
        }
      }
    });
    this.writes = write.catch(error => { this.failure = error; });
    return write;
  }

  private publicJob({ directory: _directory, files: _files, ...job }: StoredSeries): DownloadSeries {
    const transfer = this.transfer?.id === job.id ? this.transfer : undefined;
    const bytesPerSecond = transfer?.rate.perSecond() || 0;
    return { ...job, bytesPerSecond, remainingSeconds: bytesPerSecond > 0 && transfer?.remainingBytes !== undefined ? Math.ceil(transfer.remainingBytes / bytesPerSecond) : undefined };
  }

  async list(): Promise<DownloadsResponse> {
    await this.check();
    const storage = { video: 0, artwork: 0, subtitles: 0, other: 0, total: 0, capacity: 0, free: 0 };
    for (const job of this.jobs) {
      for (const file of Object.values(job.files)) storage[file.category] += file.bytes;
      for (const episode of job.episodes) if (episode.status === 'downloading') {
        const recorded = Object.entries(job.files).filter(([name, file]) => name.startsWith(`episode-${episode.number}/`) && file.category === 'video').reduce((sum, [, file]) => sum + file.bytes, 0);
        storage.video += Math.max(0, episode.bytes - recorded);
      }
    }
    storage.total = storage.video + storage.artwork + storage.subtitles;
    let ancestor = this.location;
    while (true) {
      try { const disk = await statfs(ancestor); storage.capacity = disk.blocks * disk.bsize; storage.free = disk.bavail * disk.bsize; break; }
      catch { if (dirname(ancestor) === ancestor) break; ancestor = dirname(ancestor); }
    }
    return { downloads: this.jobs.map(job => this.publicJob(job)), location: this.location, storage, canPickFolder: process.platform === 'win32' };
  }

  async setLocation(path: unknown) {
    await this.check();
    if (typeof path !== 'string' || !isAbsolute(path) || path.length > 2048 || /[\x00-\x1f]/.test(path)) throw new ApiError('INVALID_REQUEST', 'Enter an absolute folder path on the host computer.', 400);
    const location = resolve(path);
    // Use our own subdirectory so deleting downloads can never remove unrelated files.
    await mkdir(location, { recursive: true });
    const probe = join(location, `.moewatch-${randomUUID()}`);
    await writeFile(probe, ''); await rm(probe);
    this.location = location;
    await this.persist();
    return this.list();
  }

  async enqueue(anime: Anime, numbers: number[], request: PlaybackRequest, quality: DownloadQuality) {
    await this.check();
    const audio = request.audio || 'sub';
    let job = this.jobs.find(job => job.anime.id === anime.id && job.audio === audio && job.quality === quality);
    if (!job) {
      const id = randomUUID();
      job = { id, anime: structuredClone(anime), audio, quality, provider: request.provider || 'auto', fallback: request.fallback !== false, episodes: [], created: Date.now(), directory: join(this.location, `moewatch-${id}`), files: {} };
      this.jobs.unshift(job);
    }
    for (const number of [...new Set(numbers)].sort((a, b) => a - b)) {
      const existing = job.episodes.find(episode => episode.number === number);
      if (!existing) job.episodes.push({ number, status: 'queued', progress: 0, bytes: 0 });
      else if (existing.status === 'failed') { existing.status = 'queued'; existing.error = undefined; existing.progress = 0; existing.bytes = 0; }
    }
    await this.persist();
    void this.pump();
    return this.publicJob(job);
  }

  async anime(id: number) { await this.check(); return this.jobs.find(job => job.anime.id === id)?.anime; }
  async playback(id: number, number: number, audio: string) {
    await this.check();
    return this.jobs.filter(job => job.anime.id === id && job.audio === audio).flatMap(job => job.episodes).find(episode => episode.number === number && episode.status === 'complete')?.playback;
  }

  async remove(id: string) {
    await this.check();
    const job = this.jobs.find(job => job.id === id);
    if (!job) throw new ApiError('NOT_FOUND', 'Download not found', 404);
    if (this.prepared?.id === id) { this.prepared.controller.abort(); this.prepared = undefined; }
    if (this.active?.id === id) {
      this.active.controller.abort();
      await this.activeDone;
    }
    const target = resolve(job.directory);
    if (!isAbsolute(target) || target !== resolve(dirname(target), `moewatch-${job.id}`)) throw new Error('Invalid download directory');
    await rm(target, { recursive: true, force: true });
    this.jobs = this.jobs.filter(item => item.id !== id);
    await this.persist();
    void this.pump();
    return { ok: true };
  }

  private activeDone: Promise<void> = Promise.resolve();
  private prepareNext(signal: AbortSignal) {
    const job = this.jobs.find(job => job.episodes.some(episode => episode.status === 'queued'));
    const episode = job?.episodes.find(episode => episode.status === 'queued');
    if (!job || !episode || this.prepared?.id === job.id && this.prepared.episode === episode.number) return;
    this.prepared?.controller.abort();
    const controller = new AbortController();
    const request = { animeId: job.anime.id, episode: episode.number, provider: job.provider, audio: job.audio, fallback: job.fallback };
    this.prepared = { id: job.id, episode: episode.number, controller, started: Date.now(), promise: this.dependencies.resolve(request, AbortSignal.any([signal, controller.signal])).catch(() => undefined) };
  }

  private async resolved(job: StoredSeries, episode: number, signal: AbortSignal, excluded: string[]) {
    const prepared = this.prepared;
    if (!excluded.length && prepared) {
      this.prepared = undefined;
      if (prepared.id === job.id && prepared.episode === episode && Date.now() - prepared.started < 60000 && !prepared.controller.signal.aborted) {
        let aborted: () => void = () => {};
        try {
          signal.throwIfAborted();
          const result = await Promise.race([prepared.promise, new Promise<undefined>((_resolve, reject) => {
            aborted = () => { prepared.controller.abort(); reject(signal.reason); };
            signal.addEventListener('abort', aborted, { once: true });
          })]);
          signal.throwIfAborted();
          if (result && Date.now() - prepared.started < 60000 && (!result.expiresAt || result.expiresAt > Date.now() + 30000)) return result;
        } finally { signal.removeEventListener('abort', aborted); }
      } else prepared.controller.abort();
    }
    return this.dependencies.resolve({ animeId: job.anime.id, episode, provider: job.provider, audio: job.audio, fallback: job.fallback }, signal, excluded);
  }
  private async pump() {
    if (this.running || this.closed || this.failure) return;
    this.running = true;
    try {
      while (!this.closed && !this.failure) {
        const job = this.jobs.find(job => job.episodes.some(episode => episode.status === 'queued'));
        const episode = job?.episodes.find(episode => episode.status === 'queued');
        if (!job || !episode) break;
        const controller = new AbortController();
        this.active = { id: job.id, controller };
        this.activeDone = this.download(job, episode, controller.signal);
        await this.activeDone;
        this.active = undefined;
        if (controller.signal.aborted && !this.closed) break;
      }
    } catch (error) { this.failure = error instanceof Error ? error : new Error('Download storage failed'); }
    finally { this.running = false; }
  }

  private async download(job: StoredSeries, episode: StoredSeries['episodes'][number], signal: AbortSignal) {
    const folder = `episode-${episode.number}`;
    const directory = join(job.directory, folder);
    const local = (path: string) => `/api/v1/downloads/${job.id}/files/${path}`;
    const record = (prefix: string, files: SavedFile[]) => { for (const file of files) job.files[`${prefix}/${file.name}`] = file; };
    episode.status = 'downloading';
    try {
      await this.persist();
      await rm(directory, { recursive: true, force: true });
      for (const key of Object.keys(job.files)) if (key.startsWith(`${folder}/`)) delete job.files[key];
      const request = { animeId: job.anime.id, episode: episode.number, provider: job.provider, audio: job.audio, fallback: job.fallback };
      let playback: PlaybackResponse;
      let media: Awaited<ReturnType<typeof saveMedia>>;
      let source: PlaybackResponse['sources'][number];
      const excluded: string[] = [];
      while (true) {
        this.transfer = undefined;
        playback = await this.resolved(job, episode.number, signal, excluded);
        const rate = new DownloadRate();
        this.transfer = { id: job.id, rate };
        const ranked = playback.sources.map(source => ({ source, height: Number(source.quality?.match(/\d+/)?.[0]) || 0 })).filter(item => item.height).sort((a, b) => a.height - b.height);
        source = (ranked.filter(item => item.height <= job.quality).at(-1) || ranked[0])?.source || playback.sources[0];
        if (!source) throw new Error('No downloadable source');
        try {
          media = await saveMedia({ url: source.url, directory, read: this.dependencies.read, quality: job.quality, signal, onProgress: (progress, bytes, estimate) => {
            episode.progress = Math.max(episode.progress, progress); episode.bytes = bytes;
            rate.update(estimate?.transferredBytes ?? bytes);
            const completed = job.episodes.filter(item => item.status === 'complete');
            const average = completed.length ? completed.reduce((sum, item) => sum + item.bytes, 0) / completed.length : estimate?.totalBytes;
            const pending = job.episodes.filter(item => item.status === 'queued').length;
            this.transfer = { id: job.id, rate, remainingBytes: estimate?.totalBytes !== undefined ? Math.max(0, estimate.totalBytes - bytes) + (average || 0) * pending : undefined };
            if (episode.progress >= .8) this.prepareNext(signal);
            if (Date.now() - this.lastFlush > 1500) { this.lastFlush = Date.now(); void this.persist().catch(() => {}); }
          } });
          break;
        } catch (error) {
          const key = `${playback.provider}:${playback.server.id}`;
          const diskError = ['ENOSPC', 'EACCES', 'EPERM', 'EROFS'].includes((error as NodeJS.ErrnoException).code || '');
          if (!job.fallback || diskError || signal.aborted || excluded.includes(key) || excluded.length >= 17) throw error;
          excluded.push(key);
          await rm(directory, { recursive: true, force: true });
          episode.progress = 0; episode.bytes = 0;
        }
      }
      record(folder, media.files);
      this.transfer = undefined;
      const subtitles = [];
      for (let i = 0; i < playback.subtitles.length; i++) {
        const track = playback.subtitles[i];
        const prefix = `${folder}/subtitles-${i}`;
        const saved = await saveMedia({ url: track.url, directory: join(job.directory, prefix), read: this.dependencies.read, quality: job.quality, signal, category: 'subtitles' });
        record(prefix, saved.files);
        subtitles.push({ ...track, url: local(`${prefix}/${saved.entry}`) });
      }
      const saveArt = async (raw: string, name: string) => {
        if (!raw || raw.startsWith('/api/v1/downloads/')) return raw;
        const url = raw.startsWith('/media/') ? raw : await this.dependencies.artwork(raw, signal);
        const prefix = `artwork/${name}`;
        await rm(join(job.directory, prefix), { recursive: true, force: true });
        const saved = await saveMedia({ url, directory: join(job.directory, prefix), read: this.dependencies.read, quality: job.quality, signal, category: 'artwork' });
        record(prefix, saved.files);
        return local(`${prefix}/${saved.entry}`);
      };
      try {
        job.anime.cover = await saveArt(job.anime.cover, 'cover');
        job.anime.banner = await saveArt(job.anime.banner, 'banner');
        const artwork = job.anime.episodeArtwork?.find(item => item.number === episode.number);
        const url = artwork?.thumbnail || await this.dependencies.thumbnail(job.anime, episode.number, request, signal);
        if (url) {
          const thumbnail = await saveArt(url, `episode-${episode.number}`);
          if (artwork) artwork.thumbnail = thumbnail;
          else (job.anime.episodeArtwork ??= []).push({ number: episode.number, title: `Episode ${episode.number}`, thumbnail });
        }
        job.artworkWarning = undefined;
      } catch { job.artworkWarning = 'Some artwork could not be saved.'; }
      signal.throwIfAborted();
      episode.playback = { ...playback, sources: [{ ...source, url: local(`${folder}/${media.entry}`) }], subtitles, expiresAt: undefined };
      episode.bytes = media.bytes; episode.progress = 1; episode.status = 'complete'; episode.error = undefined;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      for (const key of Object.keys(job.files)) if (key.startsWith(`${folder}/`)) delete job.files[key];
      episode.bytes = 0; episode.progress = 0;
      episode.status = signal.aborted && this.closed ? 'queued' : 'failed';
      episode.error = signal.aborted ? 'Download stopped' : error instanceof Error ? error.message : 'Download failed';
    }
    if (this.transfer?.id === job.id) this.transfer = undefined;
    await this.persist();
  }

  async serve(id: string, name: string, method: string, range: string | undefined, response: ServerResponse, signal: AbortSignal) {
    await this.check();
    const job = this.jobs.find(job => job.id === id);
    const file = job?.files[name];
    if (!job || !file || !/^(?:episode-\d+(?:\/subtitles-\d+)?|artwork\/(?:cover|banner|episode-\d+))\/\d+\.(?:bin|m3u8)$/.test(name)) throw new ApiError('NOT_FOUND', 'Local file not found', 404);
    const target = resolve(job.directory, name);
    if (!target.startsWith(resolve(job.directory) + sep)) throw new ApiError('INVALID_REQUEST', 'Invalid local file', 400);
    const size = (await stat(target)).size;
    let start = 0, end = size - 1, status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || !match[1] && !match[2]) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || !match[1] && Number(match[2]) === 0) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      status = 206;
      response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    response.writeHead(status, { 'Content-Type': file.type, 'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    if (method === 'HEAD' || !size) { response.end(); return; }
    await pipeline(createReadStream(target, { start, end }), response, { signal });
  }

  async close() { this.closed = true; this.prepared?.controller.abort(); this.active?.controller.abort(); await this.activeDone; await this.writes; }
}
