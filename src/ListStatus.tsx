import { ChevronDown } from 'lucide-react';
import { accountStatuses, type AccountStatus } from '../shared/account';
import type { Anime } from './catalog';
import { useAccount } from './AccountContext';

const labels: Record<AccountStatus, string> = {
  CURRENT: 'Watching', PLANNING: 'Planning', COMPLETED: 'Completed',
  DROPPED: 'Dropped', PAUSED: 'Paused', REPEATING: 'Rewatching',
};

export function ListStatus({ anime, compact = false }: { anime: Anime; compact?: boolean }) {
  const { statusFor, setStatus, loading } = useAccount();
  const status = statusFor(anime);
  return <div className={`list-status${compact ? ' list-status-compact' : ''}`}>
    <select aria-label={`List status for ${anime.title}`} value={status ?? ''} disabled={loading}
      onChange={event => setStatus(anime, (event.target.value || null) as AccountStatus | null)}>
      <option value="" hidden>Add to list</option>
      {accountStatuses.map(value => <option key={value} value={value} hidden={value === status}>{labels[value]}</option>)}
      {status && <option value="">Remove from list</option>}
    </select>
    <span className="list-status-arrow" aria-hidden="true"><ChevronDown size={16} /></span>
  </div>;
}
