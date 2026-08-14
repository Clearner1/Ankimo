# Ankimo migration rules

## Git and parallel-task workflow

- `main` is production. Never develop, commit, or switch branches in the original `/Users/loumac/Downloads/work project/Ankimo` worktree.
- `codex` is the long-lived integration branch in `/Users/loumac/Downloads/work project/Ankimo-backup`; it must track `origin/codex`. Task sessions must not develop, commit, or push feature work directly to `codex`.
- Start each coding task in a Codex-managed disposable Worktree based on an up-to-date clean `codex`, with one task and one chat per Worktree. Keep only the existing `main` and `codex` worktrees as permanent worktrees; never run `git worktree add` or create a permanent task worktree.
- In the ChatGPT desktop app, select `No local environment` for task Worktrees. This skips automatic setup scripts; it does not change the local Mac host or shell. Do not copy ignored `node_modules`, `dist`, caches, or secrets into managed Worktrees.
- Before publishing a task, create a unique `feature/<slug>` branch and open a PR to `codex`. Never use `codex/<slug>` because the `codex` branch already owns that ref path.
- Do not install dependencies or run the full build in managed Worktrees by default. Add the focused tests the change requires and use PR CI, which runs `npm ci` and `npm run check`, as the primary code gate.
- The integration owner merges passing feature PRs into `codex` one at a time. If `codex` advances, update affected open feature branches and require CI to pass again before merging them.
- Release only through a final PR from `codex` to `main`; never commit or push directly to `main`. The final PR must pass CI. Use a merge commit, not squash, then fast-forward `codex` to `origin/main` after the release.
- After a feature PR is merged and its work is recoverable remotely, archive its chat so Codex can clean up the managed Worktree, then delete the merged feature branch if it remains.
- Use the authenticated `gh` CLI for GitHub branch, PR, review, and merge operations. Do not use GitHub app or connector tools for this repository.
- Before branching, merging, or handing off, require a clean target worktree and report `git status --short --branch`.

- Use Ponytail full: prefer existing code, browser/platform APIs, and the smallest correct implementation.
- Preserve `PRODUCT.md`, `DESIGN.md`, the current AnkiConnect behavior, and Anki as the only data source.
- During the React migration, preserve the existing DOM class names, relevant IDs, element order, ARIA behavior, and `style.css` unless a task explicitly authorizes CSS edits.
- Keep feature internals inside their assigned directory. Shared integration belongs in `src/App.tsx` and is owned by the lead agent.
- Do not add a dependency unless the assigned task explicitly requires it and existing platform/project code cannot cover the need.
- Do not add Redux, Zustand, React Query, React Router, Tailwind, a UI kit, runtime schema libraries, factories, or one-implementation interfaces.
- Do not use Computer Use, Chrome control, in-app browser control, Playwright, or any browser-driven E2E testing. The user owns real-device E2E.
- Non-trivial logic must have one focused runnable test. Do not chase coverage percentages or create broad snapshot suites.
- Before handoff, report changed files and exact check results. Passing PR CI satisfies the application gate for managed Worktrees; local-only AnkiConnect and API checks plus release and deployment verification must be serialized by the integration owner after the `codex` integration worktree is clean and no other session owns it.
- Never edit deployment, Caddy, Cloudflare Tunnel, credentials, or the original `/Users/loumac/Downloads/work project/Ankimo` worktree.
