# Discussions — Implementation Plan

Slack-style real-time discussions for featherston.co.nz.

## Open Questions
- [x] @mentions: exactly like Slack — highlighted pill in text, unread badge on thread in sidebar, dedicated Mentions & Reactions section in sidebar
- [x] Deleted messages: soft delete, show greyed-out "This message was deleted" placeholder (Slack behaviour)
- [ ] Thread archiving: can team members archive threads, or only moderators?
- [ ] Message character limit?

---

## Roles

| Role | Access |
|------|--------|
| `LOCAL` | Cannot access discussions — sees "you need to be added to the team" page |
| `RESILIENCE` | Cannot access discussions — same gate |
| `team` | Full access: read, post, create threads, edit/delete own messages |
| `moderator` | All of the above + delete anyone's messages |

---

## Tech Stack Decisions

- **Database:** Remutaka managed PostgreSQL (direct `pg` connection, no KanectaConnector)
- **Real-time:** Socket.io (handles reconnection, rooms per thread, fallbacks)
- **Emoji:** [Noto Emoji](https://fonts.google.com/noto/specimen/Noto+Emoji) (Apache 2.0, Google) via emoji-mart. Attribution in site footer/about page.
- **Auth on backend:** Validate Keycloak JWT on every API and Socket.io request
- **User identity:** First + last name pulled from Keycloak token (`given_name` + `family_name`)

---

## Database Schema

```sql
CREATE TABLE discussions_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_by_user_id VARCHAR(255) NOT NULL,
  created_by_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE discussions_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES discussions_threads(id),
  parent_message_id UUID REFERENCES discussions_messages(id), -- NULL = top-level, set = reply
  user_id VARCHAR(255) NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ  -- soft delete
);

CREATE TABLE discussions_reactions (
  message_id UUID NOT NULL REFERENCES discussions_messages(id),
  user_id VARCHAR(255) NOT NULL,
  emoji VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);
```

---

## Build Phases

### Phase 0 — Test Infrastructure Setup

#### Frontend: Storybook
- [x] Install Storybook (`@storybook/react-vite`, `@storybook/addon-essentials`, `@storybook/addon-interactions`, `@storybook/test`)
- [x] Configure `.storybook/main.ts` and `preview.ts` (include MUI theme, featherston SCSS globals)
- [x] Add mock providers: `KeycloakProvider`, `UserRole`, Socket.io (so stories work without a live backend)
- [x] Add `storybook` and `build-storybook` scripts to `package.json`
- [x] Verify Storybook runs and existing components render

**Convention:** every component in `src/components/discussions/` gets a co-located `.stories.tsx` file. Each story covers: default, loading, empty, error, and role variants (team vs moderator) where relevant.

#### Backend: Jest + Supertest
- [x] Install `jest`, `supertest`, `@types/jest`, `@types/supertest`
- [x] Configure `jest.config.js` (ESM support, test file pattern)
- [x] Add `test` and `test:watch` scripts to `featherston-api/package.json`
- [x] Create test helpers: mock Postgres pool, mock JWT middleware (so tests run without live DB or Keycloak)
- [x] Verify Jest runs

**Convention:** every route file and middleware gets a co-located `.test.js` file. Tests cover: success cases, auth failures (401), permission failures (403), validation errors (400), and not-found (404).

### Phase 1 — Foundation & Access Control
- [x] Add `moderator` role to Keycloak featherston realm (via API)
- [x] Add `MODERATOR` to `UserRole` type in frontend
- [x] Update `useUserRole.ts` to map Keycloak `moderator` realm role
- [x] Update discussions access gate: `team` and `moderator` only
- [x] Create "You need to be added to the team" page for LOCAL/RESILIENCE users
- [x] Run database schema migrations against Remutaka DB

### Phase 2 — Backend Foundation
- [x] Add `pg` package to featherston-api
- [x] Create Postgres connection pool (`db.js`)
- [x] Create Keycloak JWT validation middleware (verify against Keycloak public keys)
- [x] Thread endpoints:
  - `GET /api/discussions/threads` — list all active threads
  - `POST /api/discussions/threads` — create thread (team/moderator only)
- [x] Message endpoints:
  - `GET /api/discussions/threads/:id/messages` — paginated messages (top-level only)
  - `POST /api/discussions/threads/:id/messages` — post message
  - `PUT /api/discussions/messages/:id` — edit own message
  - `DELETE /api/discussions/messages/:id` — delete own message (or any if moderator)
- [x] Reply endpoints:
  - `GET /api/discussions/messages/:id/replies` — replies to a message
  - `POST /api/discussions/messages/:id/replies` — post a reply
- [x] Reaction endpoints:
  - `POST /api/discussions/messages/:id/reactions` — add reaction
  - `DELETE /api/discussions/messages/:id/reactions/:emoji` — remove reaction

- [x] **Tests:** `middleware/auth.test.js` (valid token, expired token, missing token, wrong audience), `routes/discussions.test.js` (all endpoints: success, 401, 403, 404, 400 validation)

### Phase 3 — Socket.io Real-time
- [x] Add `socket.io` to featherston-api
- [x] JWT auth on Socket.io handshake
- [x] Rooms: one per thread (`thread:{id}`), one per message thread (`replies:{messageId}`)
- [x] Emit events:
  - `message:new` — new top-level message
  - `message:edit` — message content updated
  - `message:delete` — message removed
  - `reply:new` — new reply to a message
  - `reaction:update` — reactions changed on a message
  - `thread:new` — new thread created
- [x] Socket.io client setup in frontend
- [x] Auto-join room when entering a thread

### Phase 4 — Frontend: Core Messaging
- [x] Replace hardcoded threads with API fetch
- [x] Replace hardcoded messages with API fetch
- [x] Enable message input — post on Enter, Shift+Enter for newline
- [x] Auto-scroll to bottom on load and on new message
- [x] Real-time: new messages appear via Socket.io
- [x] Thread creation UI (modal: name + optional description)
- [x] Real-time: new threads appear in sidebar
- [x] Loading and error states throughout
- [x] **Stories:** `ThreadList` (default, loading, empty, with unread badges), `MessageList` (default, loading, empty), `MessageInput` (default, disabled), `CreateThreadModal` (open, submitting, error)

### Phase 5 — Message Actions
- [x] Hover actions toolbar (edit / delete / react / reply)
- [x] Inline edit (click edit → input replaces text, save on Enter, cancel on Esc)
- [x] Real-time: edits update live
- [x] Delete with confirmation — soft delete, show greyed "This message was deleted"
- [x] Real-time: deletions update live
- [x] Moderator: sees delete on all messages
- [x] **Stories:** `MessageItem` (default, edited, deleted, own message, moderator view, hover state showing actions toolbar)

### Phase 6 — Threaded Replies (Slack-style)
- [x] "X replies" link below messages that have replies
- [x] Side panel slides in from right on click
- [x] Side panel shows original message + all replies
- [x] Reply input at bottom of side panel
- [x] Reply count updates in real-time
- [x] Side panel updates in real-time via `replies:{messageId}` room
- [x] **Stories:** `ReplyPanel` (empty, with replies, loading, own reply with actions)

### Phase 7 — Reactions
- [x] Emoji set: Noto Emoji via `emoji-mart` (Apache 2.0)
- [x] Add attribution to site footer/about page with link to fonts.google.com/noto
- [x] Emoji picker popover on hover action
- [x] Reaction pills below message (emoji + count)
- [x] Click own reaction to remove it
- [ ] Tooltip on reaction showing who reacted
- [x] Real-time reaction updates via Socket.io
- [x] **Stories:** `EmojiPicker` (open), `ReactionPills` (none, one type, multiple types, own reaction highlighted)

### Phase 8 — @Mentions
- [x] Trigger mention UI when `@` is typed in message input
- [x] Autocomplete dropdown showing team members (fetch from Keycloak admin API)
- [x] Render @name highlighted with coloured pill in message text
- [ ] Unread badge on thread in sidebar when you are mentioned
- [ ] Mentions & Reactions section at top of sidebar (Slack's @ button equivalent)
- [x] **Stories:** `MessageInput` with mention dropdown open, `MessageItem` with mention highlighted, `ThreadList` with mention badge

---

## Files to Create / Modify

### Backend (`featherston-api/`)
| File | Action |
|------|--------|
| `package.json` | Add `pg`, `socket.io`, `jsonwebtoken`, `jwks-rsa` |
| `db.js` | New — Postgres connection pool |
| `middleware/auth.js` | New — JWT validation middleware |
| `routes/discussions.js` | New — all REST endpoints |
| `socket/discussions.js` | New — Socket.io event handlers |
| `server.js` | Modify — wire up routes, Socket.io, remove KanectaConnector |

### Frontend (`featherston-client-web/src/`)
| File | Action |
|------|--------|
| `pages/Discussions.tsx` | Rewrite — live data, Socket.io |
| `pages/TeamRequired.tsx` | New — access gate page |
| `components/discussions/ThreadList.tsx` | New — sidebar |
| `components/discussions/MessageList.tsx` | New |
| `components/discussions/MessageItem.tsx` | New — with actions |
| `components/discussions/MessageInput.tsx` | New — with @mention support |
| `components/discussions/ReplyPanel.tsx` | New — slide-in side panel |
| `components/discussions/EmojiPicker.tsx` | New |
| `components/discussions/CreateThreadModal.tsx` | New |
| `hooks/useSocket.ts` | New — Socket.io connection hook |
| `api/discussions.ts` | New — API client functions |

---

## Attribution Required

- **Noto Emoji** — © Google LLC, Apache License 2.0
  - Must include: link to https://fonts.google.com/noto and licence notice somewhere on site

---

## Deferred (not in this phase)
- Email notifications for @mentions
- Push notifications
- File/image uploads
- Message search
- Thread archiving UI
- Admin role
- Read receipts / "last seen"
