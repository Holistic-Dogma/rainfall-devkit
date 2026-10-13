# `rainfall todos` — Public-Ingestion Surface

**Audience:** future archaeologists, AI-client integrators, and anyone who opens this repo wondering "what is this weird todos subcommand and why are the shapes so unusual?"

---

## The one-liner

> **`rainfall todos` is a deliberately security-first surface designed so AI-client interfaces (web chat, browser agents, embedded assistants) can ingest and manage a Rainfall subscriber's todo list without holding the subscriber's master API key.** Every quirk of the design — obscured public ids, the separate `x-todo-token`, partial-id matching, `visibility` on every write — exists to protect that boundary. If a shape looks weird, it's because it's holding a door shut.

**OPEN question (Crown territory):** the broader "let an external AI see and act on a Rainfall subscriber's data" pattern may subsume todos into a larger "shared surface" / `home` concept. This doc captures todos as it exists today; if/when that subsumes, this file becomes a chapter, not a surface.

---

## Why this surface exists

Rainfall subscribers authenticate with a master API key that grants full access to every tool, every integration, every piece of data tied to that subscriber. That key is **never appropriate to hand to a web chat AI, a browser agent, or any third-party model** — those environments can be prompt-injected, logged by intermediaries, or held longer than intended.

`rainfall todos` is the answer for one specific slice of that problem: **letting an AI client read and write a single, narrow, low-stakes dataset (the subscriber's todo list) without ever seeing the master key.** The trade is a separate, scoped, short-lived token and a deliberately tiny API surface.

---

## How the security boundary works

There are three distinct credentials in play, and confusing them is the whole reason this doc exists.

| Credential | What it grants | Who holds it | Lifetime |
|---|---|---|---|
| **Master API key** (`RAINFALL_API_KEY`, `x-api-key`) | Full subscriber access — every tool, every credential, every proc-node | The CLI / SDK operator only | Until revoked / rotated |
| **`todoToken`** (minted by `rainfall todos init`, sent as `x-todo-token`) | Read + write to **only** `/olympic/subscribers/{subscriberId}/todos/*` | The CLI (local config) AND the user may share it with an AI client | Default 24h; configurable up to N hours at mint time |
| **`subscriberId`** (a UUID) | Identifies whose todos to operate on — *not* a secret, but a stable handle | The CLI and the AI client | Permanent |

The flow:

```
CLI (master key)        mint token →  todos.json  ← user reads --show-token  →  web AI client
                                                                       │
                                                                       ↓  presents x-todo-token on every call
                                                        https://olympic-api.pragma-digital.org/v1/olympic/subscribers/{subscriberId}/todos
```

The AI client **cannot** mint new tokens (it has no master key), **cannot** reach any other endpoint (the backend authorizes each route by token scope), and **cannot** escalate (the token is short-lived and has only `['read', 'write']` capabilities on the todos route).

---

## CLI commands

All commands require `rainfall auth login` first (master key on disk under the standard config dir). After `init`, the `x-todo-token` lives in `<configDir>/todos.json` alongside the subscriber id.

| Command | Purpose |
|---|---|
| `rainfall todos` (bare) | Defaults to `list` — the happy path. |
| `rainfall todos init` | Mint a fresh `todoToken`, store it locally. Default 24h expiry. |
| `rainfall todos init --show-token` | Same, plus print the token once so the user can paste it into a web AI. |
| `rainfall todos init --expires <hours>` | Override the default 24h expiry (max scope defined by the API). |
| `rainfall todos token` | Print the currently stored token (for re-sharing). |
| `rainfall todos list` | Pretty-print the current todo list. |
| `rainfall todos list --category <cat>` | Filter by category. |
| `rainfall todos add <title>` | Add an item. |
| `rainfall todos add <title> --category <c>` | Set category (default `general`). |
| `rainfall todos add <title> --visibility public\|organization\|private` | Default `private`. See "Why `visibility` is on every write" below. |
| `rainfall todos add <title> --description <text>` | Optional longer description. |
| `rainfall todos check <id-or-title>` | Toggle to done. Accepts an **8-char prefix** of the id OR a title substring. |
| `rainfall todos uncheck <id-or-title>` | Toggle to not-done. Same matcher. |
| `rainfall todos rm <id-or-title>` | Delete. Same matcher. |

### Why bare `rainfall todos` defaults to `list`

The most common reason a person types `rainfall todos` is to *see* their todos. Forcing them to type `rainfall todos list` is friction on the happy path; they should never hit "Error: Unknown todos subcommand" by typing the most natural command. `init` (the second most common — "wire me up") requires an explicit subcommand because it's not reversible-friendly and mints a token.

---

## HTTP API contract

All paths live under the versioned base `https://olympic-api.pragma-digital.org/v1`. The token is sent on every request as the `x-todo-token` header. `subscriberId` is the UUID returned by `/olympic/subscribers/me` at init time.

### `POST /olympic/subscribers/{subscriberId}/account/todo-token`  *(master-key only)*

Mint a token. Requires `x-api-key`, NOT `x-todo-token` — this is the one route on the surface that uses the master credential, because minting is a privileged operation that only the operator should perform.

Request:
```json
{ "expires_hours": 24, "capabilities": ["read", "write"] }
```
Response:
```json
{ "success": true, "token": "<opaque>", "expires_at": "2026-10-14T15:00:00Z" }
```

### `GET /olympic/subscribers/{subscriberId}/todos`  *(token auth)*

List items. Query params: `category` (optional), `format=json` (required for machine clients; the default formatter is human-only).

```json
{
  "success": true,
  "items": [
    {
      "id": "a3f8c1...e7b9",            // obscured public id — see below
      "title": "Buy milk",
      "category": "shopping",
      "description": null,
      "checked": false,
      "visibility": "private",          // private | organization | public
      "mutability": "private",          // mirrors visibility at creation
      "created_at": "2026-10-13T14:00:00Z"
    }
  ]
}
```

### `POST /olympic/subscribers/{subscriberId}/todos`  *(token auth)*

Create one item. Body:

```json
{
  "title": "Buy milk",
  "category": "shopping",
  "description": "Whole milk, two cartons",     // optional
  "visibility": "private",                       // required, see below
  "mutability": "private"                        // mirrors visibility; reserved for future per-field scope
}
```

### `POST /olympic/subscribers/{subscriberId}/todos/{id}/toggle_checked`  *(token auth)*

The toggle endpoint is the only mutation that doesn't take a body — it's the most common action from an AI client and the body would be redundant. (Design note: this is a deliberate convenience for an AI typing `'rainfall todos check <id>'`.)

### `DELETE /olympic/subscribers/{subscriberId}/todos/{id}`  *(token auth)*

Remove. Hard delete from the surface (the source-of-truth store may retain soft-deletes for audit — that's a backend detail invisible to the API).

---

## Why the shapes look weird

### Obscured public ids

Ids look like `a3f8c1...e7b9` — an opaque, truncated form of the canonical UUID. **The CLI prints 8 characters; the API never returns the full UUID.**

**Why:** the full UUID is the primary key in the source-of-truth store. Handing it to an AI client means a leaked token also leaks the indexed key, which is a step toward replay / correlation across surfaces. The truncated id is enough to identify an item *within a list response* (which is where AI clients operate) but useless outside it. The full UUID never crosses the surface.

The matcher accepts any unique prefix (`a3f8c1` works) or a title substring — both ergonomics for humans typing strings into a CLI.

### `visibility` is required on every write

Every `add` takes a `--visibility` flag, default `private`. There are three values:

- `private` — only the subscriber can see this item
- `organization` — anyone in the subscriber's organization can see it
- `public` — visible to other Rainfall subscribers (think: shared "honey-do" list or team scratchpad)

**Why required, not defaulted to private:** forcing the AI client to *say* what it intends makes it auditable. If an AI client is sharing your todos publicly by accident, that's a bug worth seeing in the call — not a quiet default. An AI client that wants `private` for everything is one extra flag per write.

### `mutability` mirrors `visibility` (today)

`mutability` always equals `visibility` at write time. It's reserved for future per-field scope (a todo might be `visibility: organization` but `mutability: private` — anyone in the org can SEE it but only the owner can EDIT it). The field exists now so the API shape doesn't have to break when that lands.

### The token uses a separate header (`x-todo-token`)

Not `Authorization: Bearer`. **Why:** keeping the master-key auth and the todo-token auth on disjoint header names lets a single client (the CLI) cleanly distinguish them when proxying, and lets logging / proxy rules route on header presence without parsing values. The master key never appears on a `todos` route; the todo token never appears on a non-todos route.

### Capabilities are declared at mint, not at call

The mint request declares `capabilities: ['read', 'write']`. Currently the API only supports that exact set — but the field exists so a future "read-only token for a search-only AI" can mint without code changes.

### Token expiry is short and configurable

Default 24h, configurable at mint. **Why:** a leaked token's blast radius is the expiry window. 24h is long enough that a user can mint once and paste into a chat session without ceremony, short enough that a forgotten token is dead by next day. The user can shorten it (`--expires 1`) if they're paranoid or lengthen it for a long-running project.

### The CLI never logs the token

`todos init` only prints the token when `--show-token` is passed. `todos token` is opt-in by being a separate command. The token is never written to stdout by any other code path. This is so `rainfall todos ... | tee setup.log` doesn't accidentally bake the token into a file the user commits.

---

## Failure modes the surface handles gracefully

- **No todos yet:** `list` returns "No todo items found." and points the user at `rainfall todos add "..."`. No error.
- **No `todoToken` configured:** the relevant commands print `❌ Todo token not found. Run: rainfall todos init` and exit non-zero. No network call is made (this matters — a half-configured user shouldn't hit the API with no credentials and a confusing 401).
- **Master key missing:** `init` cannot mint a token without `x-api-key`. Same friendly error path.
- **Partial id match is ambiguous:** the matcher rejects ambiguous prefixes (multiple items share the prefix) — the CLI will tell you. Title-substring matching is also non-ambiguity-checked (multiple matches → error, not "I picked one for you").

---

## What this surface deliberately does NOT do

- **No file attachments, no rich media.** Adding attachments would mean storing blobs accessible via a scoped URL — that's a new attack surface and a new storage problem; defer until asked.
- **No sharing tokens across subscribers.** A todo belongs to one subscriber; "shared with another Rainfall subscriber" is a different concept (delegation, organizations) and lives elsewhere.
- **No webhooks / change-notifications.** An AI client polling `list` every few seconds is the supported pattern. Webhooks would require either long-lived sockets (hard to keep working across a scoped token) or a callback-registration surface that re-introduces the master-key problem.
- **No `update` (PATCH) on items.** Only `add`, `toggle_checked`, `delete`. Editing the title or description of an existing item is **not** in the surface — if it's a real need, it lands behind a separate `PATCH` route with its own scoping review. Keeping the mutation surface minimal is the point.

---

## OPEN (Crown question)

The pattern "give a non-master-key-holder scoped access to a slice of my data" recurs. Todos is the first instance; **if the pattern repeats (shared calendar? shared contacts? shared bookmarks? a shared `home`?)**, this surface may be subsumed into a larger concept that handles the mint/store/rotate lifecycle once. Today, todos is its own thing. Tomorrow, it might be `home` with a `todos` plugin. The token model (separate header, capabilities, expiry) is the part that generalizes — and is exactly what would be lifted. Tracked as OPEN.