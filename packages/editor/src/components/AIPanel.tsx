import { createAssistant, type AIMessage } from '@strata/ai';
import { Button, Icon } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

const INITIAL_SUGGESTIONS = [
  'Help me choose a color palette',
  'Suggest a layout for this design',
  'How can I improve accessibility?',
];

export function AIPanel() {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assistantRef = useRef(createAssistant());
  const chatLogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      const reply = await assistantRef.current.sendMessage(trimmed);
      setMessages((prev) => [...prev, reply]);
    } catch {
      setError('Failed to get response. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleSuggestion = useCallback(
    async (text: string) => {
      setInput(text);
      await new Promise((r) => setTimeout(r, 0));
      textareaRef.current?.focus();
    },
    [],
  );

  const handleRetry = useCallback(async () => {
    setError(null);
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return;
    setLoading(true);
    try {
      const reply = await assistantRef.current.sendMessage(lastUserMsg.content);
      setMessages((prev) => [...prev, reply]);
    } catch {
      setError('Failed to get response. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [messages]);

  return (
    <div className="ai-panel">
      <div className="ai-panel__header">
        <Icon name="Bot" size={18} />
        <span>AI Assistant</span>
      </div>

      <div ref={chatLogRef} className="ai-panel__log" role="log" aria-live="polite" aria-label="Chat messages">
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
          <div
            key={msg.id}
            className={`ai-panel__bubble ai-panel__bubble--${msg.role}`}
          >
            <div className="ai-panel__bubble-content">{msg.content}</div>
            {msg.role === 'assistant' && (
              <div className="ai-panel__bubble-actions">
                <button type="button" className="ai-panel__action-btn" aria-label="Apply suggestion">
                  <Icon name="Check" size={14} />
                  Apply
                </button>
                <button type="button" className="ai-panel__action-btn" aria-label="Preview suggestion">
                  <Icon name="Eye" size={14} />
                  Preview
                </button>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="ai-panel__bubble ai-panel__bubble--assistant">
            <div className="ai-panel__typing" aria-label="AI is typing">
              <span className="ai-panel__typing-dot" />
              <span className="ai-panel__typing-dot" />
              <span className="ai-panel__typing-dot" />
            </div>
          </div>
        )}

        {error && (
          <div className="ai-panel__error" role="alert">
            <Icon name="AlertCircle" size={14} />
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
          placeholder="Ask the AI assistant..."
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
