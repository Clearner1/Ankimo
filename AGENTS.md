# Ankimo migration rules

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
