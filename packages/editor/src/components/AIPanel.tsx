/**
 * AIPanel — the on-device design assistant chat surface.
 *
 * Runs entirely locally: every "intent" dispatches to a deterministic
 * heuristic command (`dispatchIntelligence`), and unknown intents get an
 * honest reply that lists what actually exists. There is no cloud model
 * behind this panel and no simulated latency — see `docs/architecture/
 * offline-first.md`.
 */
import { type AIMessage, createAssistant, type IntelligenceDispatchContext } from '@varve/ai';
import { Button, Icon } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../context';
import { renameSelected } from '../intelligence/autoNamer';
import { harmonizeSpacing } from '../intelligence/spacingHarmonizer';

const INITIAL_SUGGESTIONS = [
  'Check contrast on my design',
  'Scan for design debt',
  'Suggest layer names',
  'Harmonize spacing',
];

export function AIPanel() {
  const editor = useEditor();
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assistantRef = useRef(createAssistant());
  const chatLogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const buildIntelligenceContext = useCallback((): IntelligenceDispatchContext => {
    const selection = editor.state.selection;
    return {
      document: editor.state.document,
      handlers: {
        suggestNames: () => {
          const ids = selection.length > 0 ? selection : editor.rootNodes().map((n) => n.id);
          if (ids.length === 0) return 'No layers to rename — select one or more layers first.';
          editor.updateDoc((doc) => renameSelected(doc, ids, true));
          return `Suggested names applied to ${ids.length} layer${ids.length === 1 ? '' : 's'}.`;
        },
        harmonizeSpacing: () => {
          if (selection.length < 3) {
            return 'Harmonize spacing needs at least 3 selected layers.';
          }
          editor.updateDoc((doc) => harmonizeSpacing(doc, selection));
          return `Spacing harmonized across ${selection.length} layers.`;
        },
      },
    };
  }, [editor]);

  useEffect(() => {
    if (chatLogRef.current) {
      chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setInput('');
    setError(null);
    setLoading(true);

    const userMsg: AIMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const reply = await assistantRef.current.sendMessage(trimmed, buildIntelligenceContext());
      setMessages((prev) => [...prev, reply]);
    } catch {
      setError('Something went wrong running that command. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [input, loading, buildIntelligenceContext]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleSuggestion = useCallback(async (text: string) => {
    setInput(text);
    await new Promise((r) => setTimeout(r, 0));
    textareaRef.current?.focus();
  }, []);

  const handleRetry = useCallback(async () => {
    setError(null);
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return;
    setLoading(true);
    try {
      const reply = await assistantRef.current.sendMessage(
        lastUserMsg.content,
        buildIntelligenceContext(),
      );
      setMessages((prev) => [...prev, reply]);
    } catch {
      setError('Something went wrong running that command. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [messages, buildIntelligenceContext]);

  return (
    <div className="ai-panel">
      <div className="ai-panel__header">
        <Icon name="Bot" size={18} />
        <div className="ai-panel__header-text">
          <span>Design Assistant</span>
          <span className="ai-panel__header-subtitle">On-device — works offline</span>
        </div>
      </div>

      <div
        ref={chatLogRef}
        className="ai-panel__log"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 && !loading && (
          <div className="ai-panel__suggestions">
            <p className="ai-panel__suggestions-title">Try asking:</p>
            {INITIAL_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="ai-panel__suggestion-btn"
                onClick={() => handleSuggestion(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`ai-panel__bubble ai-panel__bubble--${msg.role}`}>
            <div className="ai-panel__bubble-content">{msg.content}</div>
          </div>
        ))}

        {loading && (
          <div className="ai-panel__bubble ai-panel__bubble--assistant">
            <div className="ai-panel__typing" role="img" aria-label="Running on-device command">
              <span className="ai-panel__typing-dot" />
              <span className="ai-panel__typing-dot" />
              <span className="ai-panel__typing-dot" />
            </div>
          </div>
        )}

        {error && (
          <div className="ai-panel__error" role="alert">
            <Icon name="CircleAlert" size={14} />
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={handleRetry}>
              Retry
            </Button>
          </div>
        )}
      </div>

      <div className="ai-panel__input-area">
        <textarea
          ref={textareaRef}
          className="ai-panel__textarea"
          placeholder="Ask the design assistant..."
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Chat message"
        />
        <button
          type="button"
          className="ai-panel__send-btn"
          onClick={handleSend}
          disabled={!input.trim() || loading}
          aria-label="Send message"
        >
          <Icon name="Send" size={16} />
        </button>
      </div>
    </div>
  );
}
