# Heavy Rotation

Plays a YouTube playlist with weights, so your favourite songs come around more often. Design: [`docs/superpowers/specs/2026-09-29-heavy-rotation-design.md`](docs/superpowers/specs/2026-09-29-heavy-rotation-design.md).

## Run it

From this folder:

    python3 -m http.server 8000

Then open http://localhost:8000. On a phone on the same Wi-Fi, open `http://<this computer's local IP>:8000` (on a Mac: System Settings → Wi-Fi → Details → IP address).

Tests: `node --test`. Browser checks of `app.js` against a fake YouTube player (needs Google Chrome on macOS): `tests/browser/run.sh`

## Deploy

Hosted on Vercel, imported from this GitHub repo (same setup as `4benies-tracker`): every push to `main` redeploys. No build step; Vercel serves the files as they are. `vercel.json` sends a `Permissions-Policy` header that lets the embedded YouTube player use autoplay, encrypted media, picture-in-picture and fullscreen.

## Assets

Creature art is from Kenney's **New Platformer Pack** (CC0): https://kenney.nl/assets/new-platformer-pack

Only the frames the crew uses are kept in `assets/kenney/`, with the pack's `License.txt`. To restore or add frames, download the pack again and copy SVGs from its `Vector/Characters/` and `Vector/Enemies/` folders:

- `Characters/`: `character_{beige,green,pink,purple,yellow}_{idle,walk_a,walk_b,duck}.svg`
- `Enemies/`:
  - `{slime_normal,slime_spike,slime_block,snail,ladybug,mouse}_{walk_a,walk_b,rest}.svg`
  - `worm_normal_{move_a,move_b,rest}.svg`
  - `frog_{idle,jump,rest}.svg`
  - `bee_{a,b,rest}.svg`
