import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Root, RootContent, Text, Image } from 'mdast';
import { discussionUrl } from './discussionContent';

// Convert AniList images only in text nodes, leaving code and Markdown images intact.
function remarkAniListImages() {
  return (tree: Root) => {
    function visit(node: Root | RootContent) {
      if (!('children' in node)) return;
      for (let index = 0; index < node.children.length; index++) {
        const first: RootContent = node.children[index];
        const link: RootContent | undefined = node.children[index + 1];
        const last: RootContent | undefined = node.children[index + 2];
        // GFM autolinks can split an AniList image into text / link / text.
        if (first.type === 'text' && /img\d*\($/.test(first.value) && link?.type === 'link' && last?.type === 'text' && last.value.startsWith(')')) {
          const url = discussionUrl(link.url);
          if (url) {
            const prefix: Text = { type: 'text', value: first.value.replace(/img\d*\($/, '') };
            const image: Image = { type: 'image', url, alt: 'Discussion image' };
            const suffix: Text = { type: 'text', value: last.value.slice(1) };
            node.children.splice(index, 3, prefix, image, suffix);
          }
        }
        const child: RootContent = node.children[index];
        if (child.type !== 'text') { visit(child); continue; }
        const parts: (Text | Image)[] = [];
        let end = 0;
        for (const match of child.value.matchAll(/img\d*\((https?:\/\/[^\s)]+)\)/g)) {
          if (match.index > end) parts.push({ type: 'text', value: child.value.slice(end, match.index) });
          const url = discussionUrl(match[1]);
          if (url) parts.push({ type: 'image', url, alt: 'Discussion image' });
          else parts.push({ type: 'text', value: match[0] });
          end = match.index + match[0].length;
        }
        if (!parts.length) continue;
        if (end < child.value.length) parts.push({ type: 'text', value: child.value.slice(end) });
        node.children.splice(index, 1, ...parts);
        index += parts.length - 1;
      }
    }
    visit(tree);
  };
}
function DiscussionImage({ url, label }: { url: string; label: string }) {
  const [failed, setFailed] = useState(false);
  return <a className="discussion-image" href={url} target="_blank" rel="noreferrer">{failed ? <span>Image unavailable - Open original</span> : <img src={url} alt={label} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}</a>;
}
function Content({ text }: { text: string }) {
  return <Markdown remarkPlugins={[remarkGfm, remarkAniListImages]} skipHtml components={{
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
    img: ({ src, alt }) => { const url = typeof src === 'string' ? discussionUrl(src) : null; return url ? <DiscussionImage url={url} label={alt || 'Discussion image'} /> : null; },
    p: ({ children }) => <div className="discussion-paragraph">{children}</div>,
    table: ({ children }) => <div className="discussion-table"><table>{children}</table></div>,
  }}>{text}</Markdown>;
}
export function DiscussionBody({ text }: { text: string }) {
  return <div className="discussion-body">{text.split(/(~![\s\S]*?!~)/g).map((part, i) => part.startsWith('~!') && part.endsWith('!~') ? <details className="discussion-spoiler" key={i}><summary>Spoiler</summary><Content text={part.slice(2, -2)} /></details> : <Content key={i} text={part} />)}</div>;
}
