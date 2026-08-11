# Fitflix Community Module — QA Matrix & Staging Runbook

Covers Days 1–5 of the community/social module: schema and policy, post
lifecycle and feed, member-app UI, engagement (likes/shares/comments/block/
report), and admin moderation with audit logging.

Three repositories are involved:

| Repo | Role |
| --- | --- |
| `FITFLIX_BACKEND` | API, policy layer, moderation, audit |
| `USER-APP-FITFLIX` | Member app (Flutter) |
| `frontdesk-fitflix` | Admin moderation console (Next.js) |

---

## 1. Roles

Community role is **derived per request** and never stored in the JWT
(`src/services/community/roleResolver.ts`). Precedence:

```
admin > trainer > insider > outsider
```

| Role | How it is determined |
| --- | --- |
| `admin` | An `Admin` document matches the authenticated principal |
| `trainer` | A `Trainer` document, **or** `User.communityRole === 'trainer'` (admin-granted) |
| `insider` | The user has an **active** `Membership` (queried live, never cached) |
| `outsider` | Authenticated, but no active membership |

`User.status` (`active` / `suspended` / `banned`) is an orthogonal gate: every
write action requires `active`, regardless of role.

---

## 2. QA matrix — four roles × every action

Derived from `src/services/community/policy.ts`. `can(user, action, resource)`
is the single authorization decision point; **no endpoint checks roles inline.**

### 2.1 Member-facing actions

| Action | Outsider | Insider | Trainer | Admin |
| --- | :-: | :-: | :-: | :-: |
| `post:view` — public post | ✅ | ✅ | ✅ | ✅ |
| `post:view` — members_only post | ❌ *(locked stub)* | ✅ | ✅ | ✅ |
| `post:create` | ❌ | ✅ | ✅ | ✅ |
| `post:edit` | own only ❌* | own only | own only | ✅ any |
| `post:delete` | own only ❌* | own only | own only | ✅ any |
| `post:like` | ✅ | ✅ | ✅ | ✅ |
| `post:share` | public only | public only | public only | **public only** |
| `post:comment` / `comment:create` | ❌ | ✅ | ✅ | ✅ |
| `comment:edit` / `comment:delete` | own only | own only | own only | ✅ any |
| `comment:like` | ✅ | ✅ | ✅ | ✅ |
| `post:repost` | ❌ | ❌ | ❌ | ✅ |
| `history:view` | author only | author only | author only | ✅ any |
| `user:block` | ✅ | ✅ | ✅ | ✅ |
| `report:create` | ✅ | ✅ | ✅ | ✅ |

\* An outsider cannot create posts, so "own post" is unreachable for them in
practice; the policy still resolves by authorship rather than by role.

**Two rules that deliberately do not follow role precedence:**

1. **`post:share` is public-only for everyone, including admins.** The check
   runs *before* the admin short-circuit so members_only (premium) content can
   never be shared out of the app.
2. **`history:view` is author-or-admin only, and read-only for both.** Post
   history is append-only in the database.

### 2.2 Effect of account status (all roles)

| `User.status` | Reads | Writes (post/comment/like/share/block/report) |
| --- | :-: | :-: |
| `active` | ✅ | ✅ |
| `suspended` | ✅ | ❌ 403 |
| `banned` | ✅ | ❌ 403 |

Covered by `tests/community/moderation.test.ts` →
*"suspended user CANNOT create a post (403)"*.

### 2.3 Admin moderation actions

All under `/community/admin/*`, guarded by
`authenticateToken → requireCommunityAdmin → apiRateLimit`.
Non-admins get **403**; an admin whose token lacks `scope: "admin"` gets **401
`ADMIN_SCOPE_REQUIRED`** and must re-login.

| Action | Endpoint | Step-up | Reason |
| --- | --- | :-: | :-: |
| List posts | `GET /posts` | — | — |
| View any post (incl. members_only) | `GET /posts/:id` | — | — |
| Edit post | `PATCH /posts/:id` | — | optional |
| **Delete post** | `DELETE /posts/:id` | ✅ | **required** |
| Restore post | `POST /posts/:id/restore` | — | optional |
| Pin / unpin | `POST /posts/:id/pin` \| `/unpin` | — | — |
| Create official post | `POST /posts/official` | — | — |
| List comments (incl. deleted) | `GET /posts/:id/comments` | — | — |
| **Delete comment** | `DELETE /comments/:id` | ✅ | **required** |
| View history (read-only) | `GET /posts/:id/versions` | — | — |
| Report queue | `GET /reports` | — | — |
| Resolve — dismiss / warn | `POST /reports/:id/resolve` | ✅ | optional |
| **Resolve — delete_content / suspend / ban** | `POST /reports/:id/resolve` | ✅ | **required** |
| List / view users | `GET /users`, `GET /users/:id` | — | — |
| **Suspend** | `POST /users/:id/suspend` | ✅ | **required** |
| Unsuspend | `POST /users/:id/unsuspend` | — | optional |
| **Ban** | `POST /users/:id/ban` | ✅ | **required** |
| Unban | `POST /users/:id/unban` | — | optional |
| Grant / revoke trainer role | `POST` \| `DELETE /users/:id/role` | — | optional |

- **Step-up** = a 5-minute token from `POST /community/admin/step-up`
  (re-enter password), sent as `X-Step-Up-Token`. Missing → **401**.
- **Reason required** → blank reason returns **400 `REASON_REQUIRED`**.
- **Only one post can be pinned at a time** — pinning atomically unpins the rest.

### 2.4 Invariants that must hold after any change

| Invariant | Where it is proven |
| --- | --- |
| Every admin write inserts a `moderation_actions` row **in the same transaction** | `moderation.test.ts` → *13 rows == 13 actions* |
| Audit-insert failure rolls the action back | `withOptionalTransaction` in `moderation.service.ts` |
| `post_versions` and `moderation_actions` reject UPDATE and DELETE | 4 `APPEND_ONLY_VIOLATION` assertions |
| Outsiders receive members_only posts as a locked stub with **no `content` and no `media` keys** | *"outsider members_only row is a locked stub"* |
| Blocked users are excluded **at the query layer** (`authorId: { $nin: [...] }`), symmetrically, with no indication to either party | `engagement.test.ts` |
| An admin edit writes a `PostVersion` with `editedBy = admin`, visible in the member's own history | *"admin edit wrote a post_version with editedBy = admin"* |

### 2.5 Test suites

```bash
bun run test:community              # Day 1 — schema, roles, policy      (44)
bun run test:community-posts        # Days 2-3 — posts, feed, versions   (52)
bun run test:community-engagement   # Day 4 — likes/comments/block/report(34)
bun run test:community-moderation   # Day 5 — moderation, audit, hardening(26)
```

**Total: 156.** All four run against an isolated `<db>_community_test`
database and never touch real collections.

### 2.6 Manual passes still owned by the operator

These need real devices/accounts and cannot be executed from CI:

- The member app exercised on a physical device as all four roles.
- Admin console walked end-to-end in a browser against staging.
- Push/share sheet behaviour on iOS and Android.

---

## 3. Security posture

| Control | Status |
| --- | --- |
| Admin session separate from member session | ✅ admin JWT carries `scope:"admin"`, **30 min** (`JWT_ADMIN_EXPIRES_IN`); members keep 240 d |
| Refresh cannot escalate an admin into a long unscoped session | ✅ `refreshAccessToken` re-issues an admin-scoped short token for admins |
| Step-up re-auth on destructive actions | ✅ 5 min (`JWT_STEP_UP_EXPIRES_IN`), `X-Step-Up-Token` |
| Login brute-force lockout | ✅ 5 failures → 15 min, returns 429 |
| Rate limiting on all community routes | ✅ `apiRateLimit` |
| Signed media URLs | ✅ 15-minute expiry (900 s) on every post image and blurred thumbnail |
| Report queue N+1 | ✅ none — 1 query + 3 batched `$in` lookups |
| PII in logs | ✅ community module logs nothing; login logs mask the address (`a***e@domain`) |
| Append-only history at the DB layer | ✅ app guards + optional `community_append_only_writer` role |
| **2FA on admin login** | ⛔ **Not implemented.** Deferred by explicit decision — the repo has no existing 2FA flow and no library was picked silently. |
| **Password reset** | ⛔ Not implemented. No secure flow exists in the repo; none was invented. |

> **Open item for production:** admin 2FA. The rest of the hardening is in
> place, but staff accounts remain single-factor.

---

## 4. Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGODB_URL` | — | Atlas connection string (**required**) |
| `JWT_SECRET` | — | Signing secret (**required**) |
| `JWT_EXPIRES_IN` | `240d` | Member access-token lifetime |
| `JWT_ADMIN_EXPIRES_IN` | `30m` | **Admin** access-token lifetime |
| `JWT_STEP_UP_EXPIRES_IN` | `5m` | Step-up token lifetime |
| `LOGIN_MAX_ATTEMPTS` | `5` | Failures before lockout |
| `LOGIN_LOCKOUT_MINUTES` | `15` | Lockout duration |
| `CORS_ALLOWED_ORIGINS` | — | Comma-separated; **must include the front-desk origin** |
| `AWS_*` / S3 bucket config | — | Post image upload + signed URLs |

The front desk needs `NEXT_PUBLIC_API_URL` pointing at the staging API.

> `X-Step-Up-Token` is in the CORS `Access-Control-Allow-Headers` list. If that
> header is ever trimmed, every destructive admin action fails at preflight.

---

## 5. Staging runbook

### 5.1 Migrations

```bash
bun run community:setup
```

Creates/syncs indexes for all nine community collections. Idempotent — safe to
re-run. It also prints the optional mongosh recipe for the
`community_append_only_writer` role (defence-in-depth against writes that
bypass Mongoose).

Rollback:

```bash
bun run community:teardown
```

Drops **only** the nine community collections. `users`, `memberships` and every
other shared collection are untouched by design.

Verify the round-trip safely against the isolated test database first:

```bash
bun run scripts/community-setup.ts --down --test
```

*Verified: `down` drops all 9 collections; `up` recreates all 9 on a clean DB.*

### 5.2 Seed content

```bash
bun run seed:community
```

25 launch posts (workout plans, nutrition, form guidance, announcements) —
6 `members_only`, 4 official. Every row carries **`isSeed: true`**.

- Re-running when seeds exist is a no-op (idempotent).
- `bun run seed:community --reset` removes exactly the seeded rows.
- Seeds are **text-only** by design: images require S3 upload via
  `POST /community/media/images`.

**Remove or replace the seeds before production.**

### 5.3 Smoke test

```bash
bun run scripts/community-smoke.ts --base https://<staging-host>
```

Checks liveness, that the feed responds, that admin routes reject unauthenticated
and unscoped callers, and that step-up is enforced. See
`scripts/community-smoke.ts`.

### 5.4 Deploy

Backend deploys via `vercel.json` / `bun run build:vercel`; the front desk is a
standard Next.js build. **Deploying to staging requires credentials this
repository does not carry — that step is performed by the operator.**

Post-deploy checklist:

1. `GET /health` returns `{ ok: true }`.
2. Admin logs into the front desk; `/admin/community` loads the report queue.
3. A destructive action prompts for the password and succeeds.
4. `moderation_actions` has a new row for that action.
5. A member sees the seeded feed; a non-member sees locked stubs.
