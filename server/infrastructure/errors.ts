import type { ApiErrorCode, ProviderId } from '../../shared/api';

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message: string, public status = 502, public provider?: ProviderId) {
    super(message);
    this.name = 'ApiError';
  }
}

export function asApiError(error: unknown, provider?: ProviderId): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return new ApiError('TIMEOUT', 'Upstream request timed out', 504, provider);
  }
  return new ApiError('UPSTREAM_ERROR', error instanceof Error ? error.message : 'Upstream request failed', 502, provider);
}
