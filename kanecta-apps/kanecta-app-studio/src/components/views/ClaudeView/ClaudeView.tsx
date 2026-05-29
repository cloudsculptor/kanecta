import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, IconButton, Tooltip, CircularProgress } from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useWorkspaceStore } from '../../../store/workspace';
import type { ApprovalNeededEvent, ClaudeEvent } from '../../../api/claude';
import './ClaudeView.scss';

// ── Message types displayed in the feed ─────────────────────────────────────

interface UserMessage   { kind: 'user';      text: string; }
interface AssistantMsg  { kind: 'assistant';  text: string; }
interface ToolCallMsg   { kind: 'tool';       name: string; input: Record<string, unknown>; }
interface ToolResultMsg { kind: 'tool_result'; text: string; }
interface StderrMsg     { kind: 'stderr';     text: string; }
interface ResultMsg     { kind: 'result';     text: string; }

type FeedMessage = UserMessage | AssistantMsg | ToolCallMsg | ToolResultMsg | StderrMsg | ResultMsg;

// ── Helper: extract text / tool blocks from a raw assistant message ──────────

function extractAssistantBlocks(raw: Record<string, unknown>): FeedMessage[] {
  const msg = raw as { message?: { content?: unknown[] } };
  const blocks: FeedMessage[] = [];
  for (const block of msg.message?.content ?? []) {
    const b = block as { type: string; text?: string; name?: string; input?: Record<string, unknown> };
    if (b.type === 'text' && b.text) {
      blocks.push({ kind: 'assistant', text: b.text });
    } else if (b.type === 'tool_use') {
      blocks.push({ kind: 'tool', name: b.name ?? '', input: b.input ?? {} });
    }
  }
  return blocks;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ClaudeView() {
  const { getApi } = useWorkspaceStore();

  const [prompt, setPrompt] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [feed, setFeed] = useState<FeedMessage[]>([]);
  const [pendingApproval, setPendingApproval] = useState<ApprovalNeededEvent | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addMessage = useCallback((msg: FeedMessage) => {
    setFeed(prev => [...prev, msg]);
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feed, pendingApproval]);

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
      case 'approval_needed':
        setPendingApproval(event);
        break;
      case 'approval_resolved':
        setPendingApproval(null);
        break;
      case 'stderr':
        if (event.text.trim()) addMessage({ kind: 'stderr', text: event.text });
        break;
      case 'done':
        if (event.result) addMessage({ kind: 'result', text: event.result });
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
    setPendingApproval(null);
    setPrompt('');
    setRunning(true);
    addMessage({ kind: 'user', text });

    try {
      const { id } = await api.claude.createSession(text);
      setSessionId(id);

      const url = api.claude.streamUrl(id);
      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (e: MessageEvent) => {
        try { handleEvent(JSON.parse(e.data as string) as ClaudeEvent); } catch {}
      };
      es.onerror = () => {
        setRunning(false);
        closeStream();
      };
    } catch {
      addMessage({ kind: 'stderr', text: 'Failed to start Claude session.' });
      setRunning(false);
    }
  }, [prompt, running, getApi, addMessage, handleEvent, closeStream]);

  const handleApprove = useCallback(async (approved: boolean) => {
    if (!sessionId) return;
    setPendingApproval(null);
    try { await getApi().claude.respond(sessionId, approved); } catch {}
  }, [sessionId, getApi]);

  const handleCancel = useCallback(async () => {
    if (!sessionId) return;
    closeStream();
    setRunning(false);
    try { await getApi().claude.cancel(sessionId); } catch {}
    setSessionId(null);
  }, [sessionId, getApi, closeStream]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void startSession();
    }
  }, [startSession]);

  // Auto-resize textarea
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
            <div className="ClaudeView-msg-bubble">{msg.text}</div>
          </div>
        );
      case 'tool':
        return (
          <div key={i} className="ClaudeView-msg ClaudeView-msg--tool">
            <span className="ClaudeView-msg-label">Tool call — {msg.name}</span>
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
      case 'result':
        return (
          <div key={i} className="ClaudeView-msg ClaudeView-msg--result">
            <span className="ClaudeView-msg-label">Result</span>
            <div className="ClaudeView-msg-bubble">{msg.text}</div>
          </div>
        );
    }
  };

  return (
    <div className="ClaudeView">
      {/* Header */}
      <div className="ClaudeView-header">
        <SmartToyIcon fontSize="small" />
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

      {/* Message feed */}
      {feed.length === 0 && !running ? (
        <div className="ClaudeView-empty">
          <SmartToyIcon />
          <p>Send a prompt to start a Claude session.</p>
          <p style={{ fontSize: '0.75rem' }}>Claude runs via your local CLI using your Pro subscription.</p>
        </div>
      ) : (
        <div className="ClaudeView-messages">
          {feed.map(renderMessage)}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Tool approval card */}
      {pendingApproval && (
        <div className="ClaudeView-approval">
          <div className="ClaudeView-approval-header">
            <WarningAmberIcon />
            Claude is requesting tool access
          </div>
          <div className="ClaudeView-approval-tool">
            <strong>{pendingApproval.toolName}</strong>
            <pre>{JSON.stringify(pendingApproval.toolInput, null, 2)}</pre>
          </div>
          <div className="ClaudeView-approval-actions">
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<CheckIcon />}
              onClick={() => void handleApprove(true)}
            >
              Approve
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              startIcon={<CloseIcon />}
              onClick={() => void handleApprove(false)}
            >
              Deny
            </Button>
          </div>
        </div>
      )}

      {/* Prompt input */}
      <div className="ClaudeView-input">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask Claude anything… (Enter to send, Shift+Enter for newline)"
          disabled={running}
          rows={1}
        />
        <Tooltip title="Send (Enter)">
          <span>
            <IconButton
              color="primary"
              onClick={() => void startSession()}
              disabled={running || !prompt.trim()}
            >
              <SendIcon />
            </IconButton>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}
