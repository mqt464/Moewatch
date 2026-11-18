import type { ApiErrorBody, ApiErrorCode, AvailabilityResponse, PlaybackRequest, PlaybackResponse, ProviderId, ProviderStatus, ServersResponse, AudioPreference } from '../shared/api';

export const providerNames = { reanime: 'Re:Anime', anikoto: 'KotoPlay / AniKoto', miruro: 'Miruro' };

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string, public attempts: ApiErrorBody['attempts'] = []) { super(message); }
}

export async function apiRequest<Result>(path: string, options: RequestInit = {}): Promise<Result> {
  const timeout = AbortSignal.timeout(45000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(`/api/v1${path}`, { ...options, signal, headers: { Accept: 'application/json', ...options.headers } });
  let body;
  try { body = await response.json(); }
  catch { throw new ApiError('UNAVAILABLE', `Moewatch API HTTP ${response.status}. Restart the server and retry.`); }
  if (!body || typeof body !== 'object') throw new ApiError('UPSTREAM_ERROR', 'Moewatch returned an invalid response.');
  const error = body.error && typeof body.error === 'object' ? body.error : null;
  if (!response.ok || error) throw new ApiError(error?.code || 'UPSTREAM_ERROR', error?.message || (typeof body.error === 'string' ? body.error : `Moewatch API HTTP ${response.status}`), body.attempts);
  return body as Result;
}

export async function fetchProviders(signal?: AbortSignal) {
  const result = await apiRequest<{ providers: ProviderStatus[] }>('/providers', { signal });
  if (!Array.isArray(result.providers)) throw new ApiError('UPSTREAM_ERROR', 'Moewatch returned invalid provider data.');
  return result;
}
export async function fetchAvailability(animeId: number, signal?: AbortSignal) {
  const result = await apiRequest<AvailabilityResponse>(`/anime/${animeId}/availability`, { signal });
  if (!Array.isArray(result.providers) || !result.providers.every(entry => entry && Array.isArray(entry.episodes))) throw new ApiError('UPSTREAM_ERROR', 'Moewatch returned invalid episode data.');
  return result;
}
export const fetchServers = (animeId: number, episode: number, provider: ProviderId, audio: AudioPreference, signal?: AbortSignal) => apiRequest<ServersResponse>(`/anime/${animeId}/episodes/${episode}/servers?provider=${provider}&audio=${audio}`, { signal });
export const resolvePlayback = (request: PlaybackRequest, signal?: AbortSignal) => apiRequest<PlaybackResponse>('/playback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal });
