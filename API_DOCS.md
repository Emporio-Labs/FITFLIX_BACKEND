# API documentation has moved

The API reference now lives in a single file:

## → [docs/API_REFERENCE.md](docs/API_REFERENCE.md)

---

## Why

This file and `docs/API_REFERENCE.md` were two overlapping references that had
drifted apart from each other and from the code. Both still documented three
resources — `/doctors`, `/appointments`, and `/expert-appointments` — whose
routes, controllers, and models no longer exist, and both were missing roughly
80 live endpoints.

Keeping one reference means a feature branch's API changes show up as a diff in
exactly one file, which is the whole point of the
[Endpoint index](docs/API_REFERENCE.md#endpoint-index).

## What to update when you change an endpoint

Edit [docs/API_REFERENCE.md](docs/API_REFERENCE.md) in the same commit as the
code, in two places:

1. **[Endpoint index](docs/API_REFERENCE.md#endpoint-index)** — the flat table of
   every route with its method, path, auth, roles, and handler. This is the diff
   surface for branch comparison.
2. **The prose section** for that resource — request body, response shape,
   status values, and error codes.

If you add or remove a mount in [src/app.ts](src/app.ts), also check
[Appendix B: Path aliases](docs/API_REFERENCE.md#appendix-b-path-aliases).

## Related documents

| Document | Contents |
|---|---|
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Every HTTP endpoint — **the reference** |
| [CLAUDE.md](CLAUDE.md) | Architecture, patterns, conventions, folder layout |
| [README.md](README.md) | Setup and local development |
| [docs/NUTRITION_USER_APP.md](docs/NUTRITION_USER_APP.md) | Nutrition feature guide for the user app |
| [FRONTEND_SCHEDULING_GUIDE.md](FRONTEND_SCHEDULING_GUIDE.md) | Scheduling integration notes |
