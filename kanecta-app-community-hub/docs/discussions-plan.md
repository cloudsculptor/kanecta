# Discussions — Implementation Plan

Slack-style real-time discussions for featherston.co.nz.

## Open Questions
- [ ] @mentions: highlight only, or also show a notification badge/counter to the mentioned user?
- [ ] Deleted messages: show "This message was deleted" placeholder, or remove entirely?
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

### Phase 1 — Foundation & Access Control
- [ ] Add `moderator` role to Keycloak featherston realm (via API)
- [ ] Add `MODERATOR` to `UserRole` type in frontend
- [ ] Update `useUserRole.ts` to map Keycloak `moderator` realm role
- [ ] Update discussions access gate: `team` and `moderator` only
- [ ] Create "You need to be added to the team" page for LOCAL/RESILIENCE users
- [ ] Run database schema migrations against Remutaka DB

### Phase 2 — Backend Foundation
- [ ] Add `pg` package to featherston-api
- [ ] Create Postgres connection pool (`db.js`)
- [ ] Create Keycloak JWT validation middleware (verify against Keycloak public keys)
- [ ] Thread endpoints:
  - `GET /api/discussions/threads` — list all active threads
  - `POST /api/discussions/threads` — create thread (team/moderator only)
- [ ] Message endpoints:
  - `GET /api/discussions/threads/:id/messages` — paginated messages (top-level only)
  - `POST /api/discussions/threads/:id/messages` — post message
  - `PUT /api/discussions/messages/:id` — edit own message
  - `DELETE /api/discussions/messages/:id` — delete own message (or any if moderator)
- [ ] Reply endpoints:
  - `GET /api/discussions/messages/:id/replies` — replies to a message
  - `POST /api/discussions/messages/:id/replies` — post a reply
- [ ] Reaction endpoints:
  - `POST /api/discussions/messages/:id/reactions` — add reaction
  - `DELETE /api/discussions/messages/:id/reactions/:emoji` — remove reaction

### Phase 3 — Socket.io Real-time
- [ ] Add `socket.io` to featherston-api
- [ ] JWT auth on Socket.io handshake
- [ ] Rooms: one per thread (`thread:{id}`), one per message thread (`replies:{messageId}`)
- [ ] Emit events:
  - `message:new` — new top-level message
  - `message:edit` — message content updated
  - `message:delete` — message removed
  - `reply:new` — new reply to a message
  - `reaction:update` — reactions changed on a message
  - `thread:new` — new thread created
- [ ] Socket.io client setup in frontend
- [ ] Auto-join room when entering a thread

### Phase 4 — Frontend: Core Messaging
- [ ] Replace hardcoded threads with API fetch
- [ ] Replace hardcoded messages with API fetch
- [ ] Enable message input — post on Enter, Shift+Enter for newline
- [ ] Auto-scroll to bottom on load and on new message
- [ ] Real-time: new messages appear via Socket.io
- [ ] Thread creation UI (modal: name + optional description)
- [ ] Real-time: new threads appear in sidebar
- [ ] Loading and error states throughout

### Phase 5 — Message Actions
- [ ] Hover actions toolbar (edit / delete / react / reply)
- [ ] Inline edit (click edit → input replaces text, save on Enter, cancel on Esc)
- [ ] Real-time: edits update live
- [ ] Delete with confirmation (soft-delete, show placeholder or remove TBD)
- [ ] Real-time: deletions update live
- [ ] Moderator: sees delete on all messages

### Phase 6 — Threaded Replies (Slack-style)
- [ ] "X replies" link below messages that have replies
- [ ] Side panel slides in from right on click
- [ ] Side panel shows original message + all replies
- [ ] Reply input at bottom of side panel
- [ ] Reply count updates in real-time
- [ ] Side panel updates in real-time via `replies:{messageId}` room

### Phase 7 — Reactions
- [ ] Choose emoji set: Noto Emoji via `emoji-mart` (Apache 2.0)
- [ ] Add attribution to site footer/about page with link to google.com/get/noto
- [ ] Emoji picker popover on hover action
- [ ] Reaction pills below message (emoji + count)
- [ ] Click own reaction to remove it
- [ ] Tooltip on reaction showing who reacted
- [ ] Real-time reaction updates via Socket.io

### Phase 8 — @Mentions
- [ ] Trigger mention UI when `@` is typed in message input
- [ ] Autocomplete dropdown showing team members (fetch from Keycloak admin API)
- [ ] Render @name highlighted in blue in message text
- [ ] TBD: notification badge (pending answer to open question above)

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
