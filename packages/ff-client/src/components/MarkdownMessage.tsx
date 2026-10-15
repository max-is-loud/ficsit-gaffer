// Renders chat message text as Markdown (GFM) without raw HTML, so streamed and
// reloaded messages share one safe render path.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownMessageProps {
  content: string;
}

/**
 * Renders the foreman's reply as Markdown — headings, lists, tables (via GFM),
 * inline/blocked code, links and emphasis. Used for both streamed replies and
 * rehydrated history (same render path), so reloaded conversations look identical.
 *
 * Raw HTML is intentionally NOT enabled (no rehype-raw), so model output cannot
 * inject markup; react-markdown also sanitises link URLs to safe protocols.
 * Partial Markdown that arrives mid-stream renders gracefully — the parser emits
 * what it can and reflows as more text lands.
 */
export function MarkdownMessage({ content }: MarkdownMessageProps): React.JSX.Element {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
