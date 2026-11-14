# Chat module

Direct (1-to-1) messaging between members and staff, with admin-controlled
rules for who may talk to whom. Used by the staff dashboard and the member app.

Code: `src/services/chat/`, `src/controllers/chat.controller.ts`,
`src/routes/chat.routes.ts`, models `ChatConversation`, `ChatMessage`,
`ChatPolicy` (+ `ChatOverride`). Tests: `bun run test:chat`.

## People

Accounts live in three collections, so chat addresses a person as
`{ kind, id }` — `User` (members, and staff stored as users via `staffRole`),
`Trainer`, `Admin` — and reasons about them by chat role:

`client` · `trainer` · `nutritionist` · `sports_scientist` · `doctor` ·
`frontdesk` · `admin`

No account is stored as `frontdesk` today (desk staff sign in as admins); the
role exists so a `frontdesk` token is handled.

## Who may talk to whom

Decided on every open and every send by `services/chat/policy.ts`. Nothing is
cached on a thread, so switching a rule off makes existing threads read-only.

1. **Hard stops** — yourself, an account with chat turned off, a block, and
   (setting, on by default) a member with no active membership. A lapsed
   member can still reach admins and the front desk, so they can renew.
2. **Role rules** — a directional matrix: "a `<from>` may *start* a chat with a
   `<to>`", each cell `none` | `assigned` | `all`. Admin rows are locked to
   `all`. Only cells an admin changed are stored; the rest come from
   `defaultMode()`.
3. **Per-person overrides** (`ChatOverride`) — `staffChat` (may start with any
   staff), `allClients` (may start with any member), `chatDisabled`.
4. **Relationships** — for `assigned`, the resolver registered for the staff
   role in `services/chat/relationships.ts`.

Starting is directional, replying is not: in an existing thread either side
may send while at least one direction is still allowed. That is how an admin
can message a member and get an answer without members being able to open
threads with admins. Hard stops are never lifted by the other direction.

### Defaults

| From → To | Default |
|---|---|
| admin → anyone | all (locked) |
| staff → admin | all |
| member → admin | none |
| member ↔ trainer / nutritionist / sports scientist / doctor | assigned |
| member ↔ front desk | all |
| member → member | none |
| staff → staff (non-admin) | none |

"Assigned" for a trainer is the same roster as the trainer's *My Members*
screen (`assignedTrainer`, the membership's trainer, or a booking with them);
for a nutritionist it is `getNutritionistClientIds`; for a sports scientist or
doctor it is having an appointment or booking with them.

## Extending it

- **A new assignment** (e.g. the exercise module pairing members with a coach):
  call `registerRelationship(role, { clientIdsOf, staffIdsOf })` in
  `relationships.ts`. The policy engine, the contact list and the admin matrix
  pick it up — `assigned` becomes selectable for that role.
- **A new role**: add it to `CHAT_ROLES` in `people.ts`, teach `actorFromAuth`,
  `loadPerson` and `listPeople` where those accounts live, and give it a
  default in `defaultMode()`.
- **A "Message" button in another module**: `canStartChat(from, to)` answers
  whether to show it; `POST /chat/conversations { kind, id }` returns the
  thread (existing or new).

## Safety and moderation

- **Delete** — a sender can remove their own message, an admin any message.
  It is a soft delete: the row stays (so the thread keeps its shape and a
  report can still point at it) but the text is wiped.
- **Block** — anyone except an admin can block anyone except an admin. A block
  stops both directions; the blocked person sees the same "not available"
  message as for a deactivated account.
- **Report** — a participant can flag the conversation or one message. The
  report keeps a copy of the message text, so deleting it afterwards does not
  hide it from review. Admins work the queue at `/chat/admin/reports`.
- **Oversight** — admins can list and read any conversation
  (`/chat/admin/conversations`).
- **Account deletion** — `deletion-engine.service.ts` calls
  `purgeChatDataForUser`, which removes the member's conversations (both
  sides), messages, blocks, reports and overrides.
- **One person, one identity** — a trainer usually also has a `User` record
  under the same email (it holds their push subscriptions). That record is
  left out of member lists, and opening a chat with it lands on the trainer.

## Realtime and push

Socket.IO events go to the personal room `user:<id>` every socket joins:
`chat:message` `{ conversationId, message }` (to both sides),
`chat:message_deleted` `{ conversationId, messageId }` and `chat:read`
`{ conversationId, readerId, readAt }`. Both the dashboard and the member app
hold a socket; the app drops it when backgrounded.

Clients emit `chat:focus <boolean>` to say whether their window is in front. A
recipient with no *attentive* socket gets a push instead — so a dashboard left
open in a background tab still gets one. FCM + Web Push for `User` accounts;
Web Push for trainers and admins via the `User` record that shares their email
(admins and trainers have no push store of their own).

Sending always goes over HTTP, so a dropped socket delays seeing a message but
never loses one. The app polls slowly underneath (every 30s; every 5s while the
socket is down) as a safety net. Mark-read is conditional on the thread's last
message, so a message that lands mid-request is counted, not silently read.

## Not built yet

Group threads (the `type` field is there for them), attachments and message
editing.

The backend runs as one process. Socket rooms, the rate limiter and the
15-second policy cache live in its memory — the same is true of every other
realtime feature here. Running several instances needs the Socket.IO Redis
adapter first.
