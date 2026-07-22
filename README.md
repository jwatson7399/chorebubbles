# ChoreBubbles 🫧

A shared household chore ecosystem for two people. Chores are living bubbles that swell as they go undone, weighted by importance and goal frequency. Tap a bubble to complete a chore. Effort accumulates in decaying per-person columns, a cleaning service can batch-reset chores without crediting anyone, and the household's wellbeing is summarized in one health bar.

The installable PWA runs full-screen from each phone and securely syncs shared state through Supabase.

## Features

- Bubble field with gentle physics, drag to rearrange, tap to complete
- Importance, difficulty, and goal frequency per chore
- Per-person effort columns with configurable decay half-life and shared goal
- Joint completions and cleaning-service resets
- Whole-household and per-person vacation pauses
- Seven-level household health mood
- Read-only time machine for previewing future bubble growth and point decay
- Offline app shell and durable local write queue
- Conflict-safe multi-phone saves using optimistic row revisions
- Passwordless email authentication with a two-person database allowlist

## 1. Configure Supabase

Create a free project at [supabase.com](https://supabase.com).

In **Authentication → Providers → Email**, enable email authentication. Magic-link sign-in is passwordless; users must control one of the two allowed email addresses.

In **Authentication → URL Configuration**, add the final GitHub Pages URL to the allowed redirect URLs. During development, also add the local Vite URL (normally `http://localhost:5173`).

Open `supabase-schema.sql` and replace these three placeholders:

- `REPLACE_WITH_YOUR_HOUSEHOLD_ID` with a long random household ID
- `person.one@example.com` with the first member's email
- `person.two@example.com` with the second member's email

Run the edited SQL file in the Supabase SQL Editor. It works for a new project and also migrates the original ChoreBubbles table without erasing its existing `value` data.

The database now permits reads and updates only when the signed-in user's verified email appears in that household row. The public anon key alone cannot read or modify chore data.

## 2. Configure the app

Edit `src/config.js`:

```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";
export const HOUSEHOLD_ID = "the-same-random-id-used-in-the-sql-file";
```

The URL and anon key are intentionally public client credentials; security comes from Supabase authentication and row-level policies. The household ID selects the row but does not grant access to it.

Leaving `SUPABASE_URL` empty keeps the app in single-device local-only mode, without a sign-in screen.

## 3. Deploy to GitHub Pages

1. Create a repository and push this project to `main`.
2. In repository **Settings → Pages**, set the source to **GitHub Actions**.
3. Push. The included workflow builds and deploys automatically.
4. Add the deployed URL to Supabase's allowed authentication redirect URLs.

The app will be available at `https://<username>.github.io/<repo>/`.

## 4. Install on both phones

Open the deployed URL in Safari, tap **Share → Add to Home Screen**, and launch it. Each person signs in using their approved email and opens the magic link on that phone. The app then asks whose device it is; that identity stays only on the device.

## Local development

```bash
npm install
npm run dev
```

## Sync model

Shared data remains one JSON document for simple deployment, but local edits are stored as small operations rather than whole-state replacements. Every save includes the server revision it was based on:

1. The phone queues and immediately displays the local operation.
2. It loads the newest household row.
3. It replays queued operations over that row.
4. It saves only if the server revision is unchanged.
5. If another phone saved first, it reloads and repeats.

The operation queue lives in local storage until Supabase confirms the write, so a network failure or app reload does not discard unsynced changes. Polling runs every 20 seconds and whenever the app returns to the foreground.

Simulation time never enters shared data. While fast-forwarded, edits (popping bubbles, cleaning-service resets, pauses) apply to a local sandbox copy that is discarded on returning to today, so testing never touches the shared household. Chore and settings changes stay disabled in simulation. All real, persisted events use the device's real clock.
