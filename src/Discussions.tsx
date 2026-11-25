import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, MessageCircle, ExternalLink, Lock, Heart } from 'lucide-react';
import { apiRequest } from './api';
import { useAccount } from './AccountContext';
import { DiscussionBody } from './DiscussionBody';
import { keyboardInput } from './motion';
import './discussions.css';

type Author = { name: string; avatar?: { large?: string } };
type Likes = { likeCount: number; isLiked: boolean | null };
type Thread = Likes & { id: number; title: string; body: string; replyCount: number; isLocked: boolean; createdAt: number; user: Author | null };
type Comment = Likes & { id: number; comment: string; createdAt: number; user: Author | null; childComments?: Comment[] | null };
type Data = { Page: { pageInfo: { hasNextPage: boolean }; threads?: Thread[]; threadComments?: Comment[] } };
function Byline({ user, time }: { user: Author | null; time: number }) {
  return <div className="discussion-byline">{user?.avatar?.large && <img src={user.avatar.large} alt="" loading="lazy" />}<span>{user?.name || 'Deleted user'}</span><span>&middot;</span><time dateTime={new Date(time * 1000).toISOString()}>{new Date(time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></div>;
}
function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [instant, setInstant] = useState(true);
  const id = useId();
  return <div className="discussion-disclosure" data-instant={instant}><button className="discussion-expand" aria-expanded={open} aria-controls={id} onClick={() => { setInstant(keyboardInput()); setVisited(true); setOpen(v => !v); }}><ChevronRight size={14} /><span>{open ? 'Hide replies' : label}</span></button><div className="discussion-reveal" id={id} hidden={!open}>{visited && children}</div></div>;
}
function LikeButton({ id, type, likeCount = 0, isLiked }: Likes & { id: number; type: 'THREAD' | 'THREAD_COMMENT' }) {
  const account = useAccount();
  const [state, setState] = useState({ likeCount, isLiked: !!isLiked });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false);
  async function toggle() {
    if (!account.user) { account.login(); return; }
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const next = await apiRequest<Likes>('/discussions/like', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moewatch-Account': String(account.user.id) }, body: JSON.stringify({ id, type }) });
      setState({ likeCount: next.likeCount, isLiked: !!next.isLiked });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update like.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <span className="discussion-like-control"><button className="discussion-like" aria-label={account.user ? state.isLiked ? 'Unlike' : 'Like' : 'Sign in to like'} aria-pressed={state.isLiked} aria-busy={busy} disabled={busy || (!account.user && (account.signingIn || account.configured === false))} onClick={toggle}><Heart size={14} fill={state.isLiked ? 'currentColor' : 'none'} /><span>{state.likeCount}</span></button>{error && <span className="discussion-like-error" role="alert">{error}</span>}</span>;
}
function CommentItem({ item }: { item: Comment }) {
  const children = Array.isArray(item.childComments) ? item.childComments : [];
  return <article className="discussion-comment"><Byline user={item.user} time={item.createdAt} /><DiscussionBody text={item.comment} /><div className="discussion-actions"><LikeButton id={item.id} type="THREAD_COMMENT" likeCount={item.likeCount} isLiked={item.isLiked} /></div>{children.length > 0 && <Disclosure label={`${children.length} ${children.length === 1 ? 'reply' : 'replies'}`}><div className="discussion-children">{children.map(child => <CommentItem key={child.id} item={child} />)}</div></Disclosure>}</article>;
}
function Replies({ thread, mediaId }: { thread: Thread; mediaId: number }) {
  const [data, setData] = useState<Data | null>(null), [page, setPage] = useState(1), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    apiRequest<Data>(`/discussions/${mediaId}?thread=${thread.id}&page=${page}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value); }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Replies unavailable'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [mediaId, thread.id, page, retry]);
  return <div className="discussion-children" aria-busy={loading}>{loading ? <p className="muted" role="status">Loading replies...</p> : error ? <p role="alert">{error} <button className="discussion-reply" onClick={() => setRetry(v => v + 1)}>Retry</button></p> : <div className="discussion-reveal">{data?.Page.threadComments?.map(item => <CommentItem key={item.id} item={item} />)}{!data?.Page.threadComments?.length && <p className="muted">No replies yet.</p>}<Pagination page={page} hasNext={!!data?.Page.pageInfo.hasNextPage} setPage={setPage} /></div>}</div>;
}
function Pagination({ page, hasNext, setPage }: { page: number; hasNext: boolean; setPage: (page: number) => void }) {
  return page > 1 || hasNext ? <nav className="discussion-pagination" aria-label="Discussion pages"><button className="discussion-reply" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button className="discussion-reply" disabled={!hasNext} onClick={() => setPage(page + 1)}>Next</button></nav> : null;
}
function ThreadItem({ thread, mediaId }: { thread: Thread; mediaId: number }) {
  return <article className="discussion-thread"><Byline user={thread.user} time={thread.createdAt} /><h3 className="discussion-title">{thread.title}{thread.isLocked && <Lock size={13} aria-label="Locked" />}</h3><DiscussionBody text={thread.body} /><div className="discussion-actions"><LikeButton id={thread.id} type="THREAD" likeCount={thread.likeCount} isLiked={thread.isLiked} /><a className="discussion-source" href={`https://anilist.co/forum/thread/${thread.id}`} target="_blank" rel="noreferrer">AniList<ExternalLink size={12} /></a></div><Disclosure label={`${thread.replyCount} ${thread.replyCount === 1 ? 'reply' : 'replies'}`}><Replies thread={thread} mediaId={mediaId} /></Disclosure></article>;
}

export function Discussions({ mediaId }: { mediaId: number }) {
  const { user } = useAccount();
  return <DiscussionList key={`${user?.id ?? 'guest'}:${mediaId}`} mediaId={mediaId} />;
}
function DiscussionList({ mediaId }: { mediaId: number }) {
  const account = useAccount();
  const [page, setPage] = useState(1), [data, setData] = useState<Data | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    apiRequest<Data>(`/discussions/${mediaId}?page=${page}&sort=active`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value); }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Discussions unavailable'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [mediaId, page, revision]);
  return <div className="discussions"><div className="discussion-toolbar"><h2>Discussions</h2></div>{loading ? <p className="discussion-empty" role="status">Loading discussions...</p> : error ? <div className="discussion-empty" role="alert"><p>{error}</p><button className="discussion-reply" onClick={() => refresh(v => v + 1)}>Try again</button></div> : data?.Page.threads?.length ? <div className="discussion-list">{data.Page.threads.map(thread => <ThreadItem key={thread.id} thread={thread} mediaId={mediaId} />)}</div> : <div className="discussion-empty"><MessageCircle size={24} /><p>No discussions yet.</p></div>}{!loading && !error && <Pagination page={page} hasNext={!!data?.Page.pageInfo.hasNextPage} setPage={setPage} />}{!account.user && <div className="discussion-signin"><p>Sign in with AniList to like posts and comments.</p><button className="discussion-reply" disabled={account.signingIn || account.configured === false} onClick={account.login}>{account.signingIn ? 'Signing in...' : account.configured === false ? 'Sign-in is not configured' : 'Sign in with AniList'}</button>{account.error && <p role="alert">{account.error}</p>}</div>}</div>;
}
