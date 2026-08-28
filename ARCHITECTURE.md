# Ankimo architecture

This is the source of truth for the UI migration. `AGENTS.md` enforces its
workflow and safety rules.

## Chosen UI architecture

- Vite + React + TypeScript remain the application stack.
- A migrated component owns a CSS Module. New styles use semantic CSS tokens
  such as surface, text, border, action, and state roles rather than raw
  palette values. Existing global tokens and rules stay in place until their
  component is migrated.
- Base UI is optional and selective. If used, it is wrapped and exported only
  from `src/ui`; features do not depend on Base UI directly.
- `src/App.tsx` composes features and owns cross-feature state and callbacks.
  Feature internals stay in their feature directory.
- Anki, through the existing AnkiConnect client, remains the sole data source.
  The migration changes presentation and composition only; API calls, query
  syntax, write semantics, and business flow must not change.

## Directory map

```text
src/
├── api/       AnkiConnect client and API types
├── domain/    Pure query, note, tag, and review logic
├── features/  Feature components, hooks, and focused tests
├── styles/    Semantic tokens, base rules, and the global app shell
├── ui/        Shared presentational wrappers and primitives
├── App.tsx    Application composition and cross-feature state
└── main.tsx   Vite entry point and React root mount
style.css     Existing global styles during the migration
server/       Local API service; outside the browser UI boundary
```

## Native Capture boundary

`server/ankimo-api.mts` contains the native Capture outbox implementation.
`POST /api/captures` durably queues a fixed `Ankimo` memo or Q&A creation in
SQLite and returns `202` without waiting for Anki; a single worker later calls
AnkiConnect and exposes state through `GET /api/captures/<uuid>`. The outbox is
not a browser note store and does not change existing `/v1` or AnkiConnect
contracts. After sync, the row keeps only a fingerprint/note-ID tombstone; the
capture text and tags are cleared.

The Capture route is `https://ankimo.yzr-stack.top/api/captures`, reusing the
real-iPhone-proven client-certificate host rather than the existing Bearer
middleware, and requires the
fail-closed `X-Ankimo-Client-Verified: 1` marker injected by that proxy. The
proxy must strip any client-supplied marker before mTLS verification. The
current production Caddy/Cloudflare route has not been changed; remote use and
real-iPhone acceptance remain pending explicit deployment approval. The CLI
stores the database at `~/Library/Application Support/Ankimo/outbox.sqlite3`;
tests use an in-memory or injected temporary database.

## Dependency rules

- `api` may depend on platform types, but not on React or features.
- `domain` stays pure: it may use API types, but must not perform network or
  UI work.
- Features may use `api`, `domain`, and `ui`. New feature-to-feature imports
  are not allowed; shared presentation belongs in `ui`, and coordination
  belongs in `App.tsx`.
- `ui` contains presentation only. It must not know Anki business rules or
  own application state.
- `server` is not imported by browser code. Do not add a second client data
  store or cache layer to the UI.
- Do not add a state library, router, event bus, IoC container, registry, or
  other abstraction for a single current consumer.

## Public boundaries

- `App.tsx` imports a feature's public exports from its `index.ts`; consumers
  do not reach into another feature's implementation files.
- `src/ui/index.ts` is the public surface for shared UI primitives. A Base UI
  dependency, if later adopted, is hidden behind that surface.
- `src/api/ankiConnect.ts` is the browser's boundary to AnkiConnect. Keep
  domain and feature code on the existing client contract.
- Domain modules expose pure functions and types; they do not become service
  objects merely to make imports uniform.

## CSS migration invariant

A component is migrated only when its old global CSS is deleted from
`style.css` in the same change. Leaving both a global selector and a CSS
Module for the same component is not a completed migration. Until then,
unmigrated components continue using their existing classes, IDs, element
order, ARIA behavior, and global rules.

## Deliberate YAGNI boundary

Do not add `Extension`, IoC, an event bus, a registry, plugin contracts, or
similar indirection now. React props, hooks, feature boundaries, and
`App.tsx` composition cover the current product with less code.

Revisit an extension boundary only after a second real consumer needs the same
seam. The second consumer must be concrete, not a speculative future use;
document the repeated contract and add one focused test before introducing
the abstraction.
