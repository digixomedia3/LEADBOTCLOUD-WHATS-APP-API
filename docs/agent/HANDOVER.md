# HANDOVER procedure (run when the human says "handover")

We're ending this work session. The next session may be run by the other developer on a different machine, with no memory of this conversation. Prepare a complete handover:

1. **Check state:** run lint, typecheck and tests. Note anything failing (don't hide it).
2. **Commit everything** that is working, with clear messages, on the current branch. If something is half-done, commit it as WIP on a feature branch (never on `dev`/`main`) and say so.
3. **Push** the branch to GitHub. If the work is complete and tested, open a PR to `dev` with `gh pr create` (title, summary, manual test steps).
4. **Rewrite the "Latest handover" section of `docs/PROGRESS.md`** (keep older entries below in "History", newest first, trimmed to the last 10) using exactly this structure:

   ## Latest handover: <date IST> · by <Deep / Partner> · branch <name> · last commit <short sha>
   ### What was done this session
   ### Current state of the app (what works end to end right now)
   ### How to run it locally (exact commands, any new env vars, migrations, seed data)
   ### How to test what changed (step-by-step, incl. phone/360px checks)
   ### Not finished / known bugs / failing tests
   ### Next steps (ordered, with the spec section to read for each)
   ### Decisions made + open questions (also update docs/open-questions.md)
   ### Credentials/env changes the other developer needs (names only, never values)

5. Update the module checklist in `docs/PROGRESS.md` (✅ done · 🟡 in progress · ⬜ not started) against spec §A4/§A8.
6. Commit and push the PROGRESS.md update.
7. Finally, show me a short summary: branch, PR link (if any), and the top 3 next steps.
