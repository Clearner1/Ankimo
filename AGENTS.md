# Ankimo migration rules

`ARCHITECTURE.md` is the source of truth for the React/CSS migration,
dependency boundaries, public surfaces, and YAGNI decisions below.

## Git and parallel-task workflow

- `main` is production and its checkout at `/Users/loumac/Downloads/work project/Ankimo` remains untouched during development.
- `codex` is the long-lived integration branch in `/Users/loumac/Downloads/work project/Ankimo-backup`; it must track `origin/codex`.
- Each parallel sub-agent gets one disposable Worktree on a unique `feature/<slug>` branch created from a clean, up-to-date `codex`. Each agent owns a non-overlapping scope; do not create a second Worktree for the same task.
- The lead agent integrates feature branches into `codex` one at a time and runs the full checks from a clean integration checkout. Delete the temporary Worktree and merged feature branch after integration.
- Publish each feature branch through a PR to `codex`; use the authenticated `gh` CLI for that handoff.
- In the ChatGPT desktop app, select `No local environment` for task Worktrees. This skips automatic setup scripts; it does not change the local Mac host or shell. Do not copy ignored `node_modules`, `dist`, caches, or secrets into managed Worktrees.
- Never use `codex/<slug>` because the `codex` branch already owns that ref path.
- Do not install dependencies or run the full build in managed Worktrees by default. Add the focused tests the change requires and use PR CI, which runs `npm ci` and `npm run check`, as the primary code gate.
- Release only through a final PR from `codex` to `main`; never commit or push directly to `main`. The final PR must pass CI. Use a merge commit, not squash, then fast-forward `codex` to `origin/main` after the release.
- Use the authenticated `gh` CLI for GitHub branch, PR, review, and merge operations. Do not use GitHub app or connector tools for this repository.
- Before branching, merging, or handing off, require a clean target worktree and report `git status --short --branch`.

## UI architecture

- Follow `ARCHITECTURE.md`: Vite + React + TypeScript, CSS Modules for migrated components, semantic CSS tokens, selective Base UI only behind `src/ui`, and feature composition through `src/App.tsx`.
- A component is migrated only when its old global CSS is deleted from `style.css` in the same change. Preserve existing DOM class names, relevant IDs, element order, and ARIA behavior until that component's migration is complete.
- Preserve AnkiConnect as the only data source and keep the existing API and business flow unchanged during UI migration.
- Do not add `Extension`, IoC, an event bus, a registry, plugin contracts, or other indirection yet. Add an extension boundary only after a second real consumer demonstrates the same contract.

- Use Ponytail full: prefer existing code, browser/platform APIs, and the smallest correct implementation.
- Preserve `PRODUCT.md`, `DESIGN.md`, the current AnkiConnect behavior, and Anki as the only data source.
- Keep feature internals inside their assigned directory. Shared integration belongs in `src/App.tsx` and is owned by the lead agent.
- Do not add a dependency unless the assigned task explicitly requires it and existing platform/project code cannot cover the need.
- Do not add Redux, Zustand, React Query, React Router, Tailwind, runtime schema libraries, factories, or one-implementation interfaces. Base UI is allowed only selectively behind `src/ui`; do not add another UI kit.
- Do not use Computer Use, Chrome control, in-app browser control, Playwright, or any browser-driven E2E testing. The user owns real-device E2E.
- Non-trivial logic must have one focused runnable test. Do not chase coverage percentages or create broad snapshot suites.
- Before handoff, report changed files and exact check results. Passing PR CI satisfies the application gate for managed Worktrees; local-only AnkiConnect and API checks plus release and deployment verification must be serialized by the integration owner after the `codex` integration worktree is clean and no other session owns it.
- Never edit deployment, Caddy, Cloudflare Tunnel, credentials, or the original `/Users/loumac/Downloads/work project/Ankimo` worktree.
