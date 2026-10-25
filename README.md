# Prompt-Based Video Editing Engine (IncuBrix Assessment 2 — simple version)

Type what you want ("cut the first 30 seconds", "remove the part about pricing"); the engine turns it into structured, reversible operations on a timeline and renders the result.

**Live demo:** see the Vercel link in the repo description / below. **Sample video:** `sample/interview.mp4` (3:06, synthetic TTS speaker, with `sample/transcript.json`).

## How it works
- `engine/engine.js` — rule-based instruction parser + timeline logic (no AI model, so it is fully deterministic).
- **Edits belong to content.** Every op is stored in *original source time* (cuts, speed, captions anchored to word indexes). The timeline is a pure function replayed from the history on the untouched original, so captions follow their words after any cut/speed/restore.
- **History:** one instruction = one history entry. `undo`/`redo` move whole entries; a new edit clears redo; "put back X" adds a `restore` entry that neutralises one earlier cut while leaving the others.
- **Three answers:** `applied` (operations + before/after length), `needs_clarification` (question + options, answered with `answer:`), `rejected` (reason).
- **Time policy:** times you type are *current (edited) timeline* times; every answer says so.
- Cuts snap to word edges so no word is clipped. Captions under a minimum of 0.7 s after speed-up are extended. A caption whose words are fully cut is hidden with a warning and returns on restore.
- Rendering (`cli/render.js`, ffmpeg) is a separate step and only reads the source.

## Run
```
npm install
npm test                                  # unit tests
npm run demo                              # runs sample/worked_example.yaml -> out/results.json, out/timeline.json, out/output.mp4
node cli/run.js my_session.yaml outdir    # session runner (format from the brief)
```
API: `POST /api/v1/session` `{"steps":[{"say":"...","answer":"..."}]}` → per-step results + timeline (stateless replay).

## Supported instructions
cut range / first N s / last N s / "part about X" / "everything after I say X" · fillers (um/uh) · silences longer than N s · speed 0.25x–4x · caption (on words or at a time) · auto-caption · restyle caption (colour, bigger/smaller) · mute/bleep a word · background music (ducks under speech) · undo · redo · put back · render.

## Not done (honest scope)
Reorder/keep-only, multi-part instructions, OpenTimelineIO export, Docker/MinIO/job queue/OpenAPI/idempotency (Integration Standard), speaker-aware edits, real speech-to-text (sample transcript is generated from the TTS script; word times are proportional to word length), real music (a placeholder tone is used). The Vercel demo previews the edited timeline in the browser; the final MP4 is produced with the CLI.

## Sources / AI use
ffmpeg-static (GPL ffmpeg binary, used only by the CLI), yaml (ISC). Sample audio: Windows SAPI TTS. Code written with Claude Code (Anthropic).
