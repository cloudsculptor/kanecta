import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewMeta } from '../../../lib/viewMeta';
import { useViewLocation } from '../../../context/LocationContext';

export const ClaudeViewMeta: ViewMeta = {
  uuid: 'd7c6e5f4-a8b9-4c0d-1e2f-3a4b5c6d7e8f',
  name: 'claude',
  label: 'Claude',
  icon: 'AutoAwesome',
};
import { IconButton, Tooltip, CircularProgress } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import ReactMarkdown from 'react-markdown';
import { useWorkspaceStore } from '../../../store/workspace';
import type { ClaudeEvent } from '../../../api/claude';
import './ClaudeView.scss';

// ── Claude logo SVG ──────────────────────────────────────────────────────────

function ClaudeLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"
        fill="#CC785C"
      />
      <path
        d="M14.5 7.5L10 16.5M9.5 7.5L14 16.5"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Message types ────────────────────────────────────────────────────────────

interface UserMessage    { kind: 'user';        text: string; }
interface AssistantMsg   { kind: 'assistant';   text: string; }
interface ToolRanMsg     { kind: 'tool_ran';    name: string; input: Record<string, unknown>; }
interface ToolResultMsg  { kind: 'tool_result'; text: string; }
interface StderrMsg      { kind: 'stderr';      text: string; }

type FeedMessage = UserMessage | AssistantMsg | ToolRanMsg | ToolResultMsg | StderrMsg;

function extractAssistantBlocks(raw: Record<string, unknown>): FeedMessage[] {
  const msg = raw as { message?: { content?: unknown[] } };
  const blocks: FeedMessage[] = [];
  for (const block of msg.message?.content ?? []) {
    const b = block as { type: string; text?: string; name?: string; input?: Record<string, unknown> };
    if (b.type === 'text' && b.text) blocks.push({ kind: 'assistant', text: b.text });
  }
  return blocks;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ClaudeView() {
  useViewLocation(ClaudeViewMeta.uuid);
  const { getApi } = useWorkspaceStore();

  const [prompt, setPrompt] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [feed, setFeed] = useState<FeedMessage[]>([]);

  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const addMessage = useCallback((msg: FeedMessage) => {
    setFeed(prev => [...prev, msg]);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feed]);

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const handleEvent = useCallback((event: ClaudeEvent) => {
    switch (event.type) {
      case 'raw': {
        const raw = event.event;
        if (raw.type === 'assistant') {
          for (const msg of extractAssistantBlocks(raw)) addMessage(msg);
        } else if (raw.type === 'tool') {
          const r = raw as { content?: string };
          if (r.content) addMessage({ kind: 'tool_result', text: r.content });
        }
        break;
      }
      case 'tool_ran':
        addMessage({ kind: 'tool_ran', name: event.toolName, input: event.toolInput });
        break;
      case 'stderr':
        if (event.text.trim()) addMessage({ kind: 'stderr', text: event.text });
        break;
      case 'done':
        setRunning(false);
        closeStream();
        break;
    }
  }, [addMessage, closeStream]);

  const startSession = useCallback(async () => {
    const text = prompt.trim();
    if (!text || running) return;

    const api = getApi();
    setFeed([]);
    setPrompt('');
    setRunning(true);
    addMessage({ kind: 'user', text });

    try {
      const { id } = await api.claude.createSession(text);
      setSessionId(id);

      const es = new EventSource(api.claude.streamUrl(id));
      esRef.current = es;

      es.onmessage = (e: MessageEvent) => {
        try { handleEvent(JSON.parse(e.data as string) as ClaudeEvent); } catch { /* ignore parse errors */ }
      };
      es.onerror = () => { setRunning(false); closeStream(); };
    } catch {
      addMessage({ kind: 'stderr', text: 'Failed to start Claude session.' });
      setRunning(false);
    }
  }, [prompt, running, getApi, addMessage, handleEvent, closeStream]);

  const handleCancel = useCallback(async () => {
    if (!sessionId) return;
    closeStream();
    setRunning(false);
    try { await getApi().claude.cancel(sessionId); } catch { /* ignore */ }
    setSessionId(null);
  }, [sessionId, getApi, closeStream]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void startSession(); }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const renderMessage = (msg: FeedMessage, i: number) => {
    switch (msg.kind) {
      case 'user':
        return (
          <div key={i} className="ClaudeView-msg ClaudeView-msg--user">
            <span className="ClaudeView-msg-label">You</span>
            <div className="ClaudeView-msg-bubble">{msg.text}</div>
          </div>
        );
      case 'assistant':
        return (
          <div key={i} className="ClaudeView-msg ClaudeView-msg--assistant">
            <span className="ClaudeView-msg-label">Claude</span>
            <div className="ClaudeView-msg-bubble ClaudeView-msg-bubble--markdown">
              <ReactMarkdown>{msg.text}</ReactMarkdown>
            </div>
          </div>
        );
      case 'tool_ran':
        return (
          <div key={i} className="ClaudeView-msg ClaudeView-msg--tool">
            <span className="ClaudeView-msg-label">Tool — {msg.name}</span>
            <div className="ClaudeView-msg-bubble">
              <pre>{JSON.stringify(msg.input, null, 2)}</pre>
            </div>
          </div>
        );
      case 'tool_result':
        return (
          <div key={i} className="ClaudeView-msg ClaudeView-msg--tool">
            <span className="ClaudeView-msg-label">Tool result</span>
            <div className="ClaudeView-msg-bubble">{msg.text}</div>
          </div>
        );
      case 'stderr':
        return (
          <div key={i} className="ClaudeView-msg ClaudeView-msg--stderr">
            <span className="ClaudeView-msg-label">stderr</span>
            <div className="ClaudeView-msg-bubble">{msg.text}</div>
          </div>
        );
    }
  };

  return (
    <div className="ClaudeView">
      <div className="ClaudeView-header">
        <ClaudeLogo size={20} />
        <h2>Claude CLI</h2>
        {running && (
          <>
            <span className="ClaudeView-header-status">
              <CircularProgress size={12} sx={{ mr: 0.5 }} />
              Running…
            </span>
            <Tooltip title="Cancel session">
              <IconButton size="small" className="ClaudeView-header-cancel" onClick={() => void handleCancel()}>
                <StopIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </div>

      {feed.length === 0 && !running ? (
        <div className="ClaudeView-empty">
          <ClaudeLogo size={48} />
          <p>Send a prompt to start a Claude session.</p>
          <p style={{ fontSize: '0.75rem' }}>Runs via your local Claude CLI using your Pro subscription.</p>
        </div>
      ) : (
        <div className="ClaudeView-messages">
          {feed.map(renderMessage)}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="ClaudeView-input">
        <textarea
          value={prompt}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask Claude anything… (Enter to send, Shift+Enter for newline)"
          disabled={running}
          rows={1}
        />
        <Tooltip title="Send (Enter)">
          <span>
            <IconButton color="primary" onClick={() => void startSession()} disabled={running || !prompt.trim()}>
              <SendIcon />
            </IconButton>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}
