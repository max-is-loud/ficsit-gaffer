// The chat pane: scrolling list of messages rendered through MarkdownMessage,
// with the composer that sends the pioneer's text.

import { useEffect, useRef, useState } from 'react';

import type { ChatMsg } from '../useForeman.js';
import { MarkdownMessage } from './MarkdownMessage.js';

interface ChatColumnProps {
  messages: ChatMsg[];
  sending: boolean;
  onSend: (text: string) => void;
}

/** The foreman conversation: streamed messages plus the composer. */
export function ChatColumn({ messages, sending, onSend }: ChatColumnProps): React.JSX.Element {
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const submit = (): void => {
    if (draft.trim().length === 0 || sending) {
      return;
    }
    onSend(draft);
    setDraft('');
  };

  return (
    <section className="pane chat">
      <div className="pane-head">
        <span className="tick label">⟩</span>
        <span className="label">Foreman</span>
      </div>

      <div className="messages">
        {messages.length === 0 ? (
          <p className="empty">
            The foreman is on shift. Ask what to build next, report a problem, or say you have
            finished an order.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`msg ${m.role === 'assistant' ? 'foreman' : 'pioneer'}`}>
              <span
                className={`marker${m.role === 'assistant' && m.streaming ? ' thinking' : ''}`}
                aria-hidden="true"
              >
                {m.role === 'assistant' ? '⟩' : '›'}
              </span>
              <div>
                <div className="body">
                  {m.role === 'assistant' ? <MarkdownMessage content={m.content} /> : m.content}
                  {m.streaming && m.content.length === 0 && m.tools.length === 0 ? (
                    <span className="caret" aria-hidden="true" />
                  ) : null}
                </div>
                {m.tools.length > 0 ? (
                  <div className="tools">
                    {m.tools.map((t, i) => (
                      <span key={`${t}-${i}`} className="tool-chip">
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
                {m.error !== undefined ? <div className="err">{m.error}</div> : null}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Message the foreman…"
          aria-label="Message the foreman"
        />
        <button type="button" className="send" onClick={submit} disabled={sending}>
          {sending ? 'Working' : 'Send'}
        </button>
      </div>
    </section>
  );
}
