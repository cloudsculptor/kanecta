import type { ApiClient } from './client';

export interface ClaudeSession {
  id: string;
}

export interface ApprovalNeededEvent {
  type: 'approval_needed';
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}

export interface ToolRanEvent {
  type: 'tool_ran';
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}

export interface RawEvent {
  type: 'raw';
  event: Record<string, unknown>;
}

export interface DoneEvent {
  type: 'done';
  result?: string;
  code?: number | null;
}

export interface StderrEvent {
  type: 'stderr';
  text: string;
}

export interface ApprovalResolvedEvent {
  type: 'approval_resolved';
  approved: boolean;
}

export type ClaudeEvent =
  | ApprovalNeededEvent
  | ToolRanEvent
  | RawEvent
  | DoneEvent
  | StderrEvent
  | ApprovalResolvedEvent;

export function claudeApi(client: ApiClient, baseUrl: string) {
  return {
    createSession: (prompt: string, workingDir?: string) =>
      client.post<ClaudeSession>('/claude/sessions', { prompt, workingDir }),

    streamUrl: (id: string) => `${baseUrl}/claude/sessions/${id}/stream`,

    respond: (id: string, approved: boolean) =>
      client.post<{ ok: boolean }>(`/claude/sessions/${id}/respond`, { approved }),

    cancel: (id: string) =>
      client.delete<{ ok: boolean }>(`/claude/sessions/${id}`),
  };
}
