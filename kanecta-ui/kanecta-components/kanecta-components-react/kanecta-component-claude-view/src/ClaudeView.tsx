import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton, Tooltip, CircularProgress } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import ReactMarkdown from 'react-markdown';
import './ClaudeView.scss';

// ── Local event types (mirror of api-client shapes) ──────────────────────────

interface ApprovalNeededEvent { type: 'approval_needed'; toolName: string; toolInput: Record<string, unknown>; toolUseId: string; }
interface ToolRanEvent        { type: 'tool_ran';        toolName: string; toolInput: Record<string, unknown>; toolUseId: string; }
interface RawEvent            { type: 'raw';             event: Record<string, unknown>; }
interface DoneEvent           { type: 'done';            result?: string; code?: number | null; }
interface StderrEvent         { type: 'stderr';          text: string; }
interface ApprovalResolvedEvent { type: 'approval_resolved'; approved: boolean; }

export type ClaudeStreamEvent =
  | ApprovalNeededEvent
  | ToolRanEvent
  | RawEvent
  | DoneEvent
  | StderrEvent
  | ApprovalResolvedEvent;

// ── Props ────────────────────────────────────────────────────────────────────

export interface ClaudeViewProps {
  createSession: (prompt: string) => Promise<{ id: string }>;
  streamUrl: (id: string) => string;
  cancelSession: (id: string) => Promise<unknown>;
}

// ── Claude logo ──────────────────────────────────────────────────────────────

function ClaudeLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" fill="#CC785C" />
      <path d="M14.5 7.5L10 16.5M9.5 7.5L14 16.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// ── Feed message types ───────────────────────────────────────────────────────

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
    const b = block as { type: string; text?: string };
    if (b.type === 'text' && b.text) blocks.push({ kind: 'assistant', text: b.text });
  }
  return blocks;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ClaudeView({ createSession, streamUrl, cancelSession }: ClaudeViewProps) {
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

  const handleEvent = useCallback((event: ClaudeStreamEvent) => {
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

    setFeed([]);
    setPrompt('');
    setRunning(true);
    addMessage({ kind: 'user', text });

    try {
      const { id } = await createSession(text);
      setSessionId(id);

      const es = new EventSource(streamUrl(id));
      esRef.current = es;

      es.onmessage = (e: MessageEvent) => {
        try { handleEvent(JSON.parse(e.data as string) as ClaudeStreamEvent); } catch { /* ignore parse errors */ }
      };
      es.onerror = () => { setRunning(false); closeStream(); };
    } catch {
      addMessage({ kind: 'stderr', text: 'Failed to start Claude session.' });
      setRunning(false);
    }
  }, [prompt, running, createSession, streamUrl, addMessage, handleEvent, closeStream]);

  const handleCancel = useCallback(async () => {
    if (!sessionId) return;
    closeStream();
    setRunning(false);
    try { await cancelSession(sessionId); } catch { /* ignore */ }
    setSessionId(null);
  }, [sessionId, cancelSession, closeStream]);

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
          <div key={i} className="ClaudeView__msg ClaudeView__msg--user">
            <span className="ClaudeView__msg-label">You</span>
            <div className="ClaudeView__msg-bubble">{msg.text}</div>
          </div>
        );
      case 'assistant':
        return (
          <div key={i} className="ClaudeView__msg ClaudeView__msg--assistant">
            <span className="ClaudeView__msg-label">Claude</span>
            <div className="ClaudeView__msg-bubble ClaudeView__msg-bubble--markdown">
              <ReactMarkdown>{msg.text}</ReactMarkdown>
            </div>
          </div>
        );
      case 'tool_ran':
        return (
          <div key={i} className="ClaudeView__msg ClaudeView__msg--tool">
            <span className="ClaudeView__msg-label">Tool — {msg.name}</span>
            <div className="ClaudeView__msg-bubble">
              <pre>{JSON.stringify(msg.input, null, 2)}</pre>
            </div>
          </div>
        );
      case 'tool_result':
        return (
          <div key={i} className="ClaudeView__msg ClaudeView__msg--tool">
            <span className="ClaudeView__msg-label">Tool result</span>
            <div className="ClaudeView__msg-bubble">{msg.text}</div>
          </div>
        );
      case 'stderr':
        return (
          <div key={i} className="ClaudeView__msg ClaudeView__msg--stderr">
            <span className="ClaudeView__msg-label">stderr</span>
            <div className="ClaudeView__msg-bubble">{msg.text}</div>
          </div>
        );
    }
  };

  return (
    <div className="ClaudeView">
      <div className="ClaudeView__header">
        <ClaudeLogo size={20} />
        <h2>Claude CLI</h2>
        {running && (
          <>
            <span className="ClaudeView__header-status">
              <CircularProgress size={12} sx={{ mr: 0.5 }} />
              Running…
            </span>
            <Tooltip title="Cancel session">
              <IconButton size="small" className="ClaudeView__header-cancel" onClick={() => void handleCancel()}>
                <StopIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </div>

      {feed.length === 0 && !running ? (
        <div className="ClaudeView__empty">
          <ClaudeLogo size={48} />
          <p>Send a prompt to start a Claude session.</p>
          <p style={{ fontSize: '0.75rem' }}>Runs via your local Claude CLI using your Pro subscription.</p>
        </div>
      ) : (
        <div className="ClaudeView__messages">
          {feed.map(renderMessage)}
          <div ref={bottomRef} />
        </div>
      )}

      <div className="ClaudeView__input">
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
