import type { KanectaApiClient } from '@kanecta/api-client';
import type {
  ClaudeSession,
  ApprovalNeededEvent,
  ToolRanEvent,
  RawEvent,
  DoneEvent,
  StderrEvent,
  ApprovalResolvedEvent,
  ClaudeEvent,
} from '@kanecta/api-client';

export type {
  ClaudeSession,
  ApprovalNeededEvent,
  ToolRanEvent,
  RawEvent,
  DoneEvent,
  StderrEvent,
  ApprovalResolvedEvent,
  ClaudeEvent,
};

export function claudeApi(client: KanectaApiClient) {
  return {
    createSession: (prompt: string, workingDir?: string) =>
      client.claude.createSession(prompt, workingDir),

    streamUrl: (id: string) => client.claude.streamUrl(id),

    respond: (id: string, approved: boolean) => client.claude.respond(id, approved),

    cancel: (id: string) => client.claude.cancelSession(id),
  };
}
