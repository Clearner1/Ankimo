# Ankimo migration rules

## Git workflow

- `main` is production. Never develop, commit, or switch branches in the original `/Users/loumac/Downloads/work project/Ankimo` worktree.
- `codex` is the long-lived development and integration branch in `/Users/loumac/Downloads/work project/Ankimo-backup`; it must track `origin/codex`.
- For one ordinary change, work directly on `codex`, run the relevant checks, then open a PR from `codex` to `main`.
- Create a temporary `feature/<slug>` branch from an up-to-date `codex` only when parallel work, isolated rollback, or integration review is useful. Merge it back to `codex` by PR, then delete it. Never use `codex/<slug>` because the `codex` branch already owns that ref path.
- Release only through a PR from `codex` to `main`; never commit or push directly to `main`. Use a merge commit, not squash, then fast-forward `codex` to `origin/main` after the release.
- Use the authenticated `gh` CLI for GitHub branch, PR, review, and merge operations. Do not use GitHub app or connector tools for this repository.
- Use only the two existing worktrees. Never run `git worktree add`. Before branching, merging, or handing off, require a clean worktree and report `git status --short --branch`.

- Use Ponytail full: prefer existing code, browser/platform APIs, and the smallest correct implementation.
- Preserve `PRODUCT.md`, `DESIGN.md`, the current AnkiConnect behavior, and Anki as the only data source.
- During the React migration, preserve the existing DOM class names, relevant IDs, element order, ARIA behavior, and `style.css` unless a task explicitly authorizes CSS edits.
- Keep feature internals inside their assigned directory. Shared integration belongs in `src/App.tsx` and is owned by the lead agent.
- Do not add a dependency unless the assigned task explicitly requires it and existing platform/project code cannot cover the need.
- Do not add Redux, Zustand, React Query, React Router, Tailwind, a UI kit, runtime schema libraries, factories, or one-implementation interfaces.
- Do not use Computer Use, Chrome control, in-app browser control, Playwright, or any browser-driven E2E testing. The user owns real-device E2E.
- Non-trivial logic must have one focused runnable test. Do not chase coverage percentages or create broad snapshot suites.
- Before handoff, run the checks relevant to the files you own and report changed files plus exact command results.
- Never edit deployment, Caddy, Cloudflare Tunnel, credentials, or the original `/Users/loumac/Downloads/work project/Ankimo` worktree.
