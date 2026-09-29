# Heavy Rotation — design

Date: 2026-09-29
Project folder: `weighted-playlist/`
Mockup: [`docs/mockup.html`](../../mockup.html) (also published as a private artifact)

## Purpose

A personal web page that plays a YouTube playlist with **weights**, so favourite songs come around more often than the rest. YouTube playlists can't hold the same video twice, so there is no way to hear favourites more often there. Heavy Rotation fills that gap.

It is for the owner's own listening, in a desktop or phone browser. Every play is an ordinary play in YouTube's embedded player at normal speed. The app does nothing to influence view counts, ads or YouTube's playback rules.

### Success looks like

- Paste a playlist link, set a few weights, press play, and it keeps playing with favourites coming up in proportion to their weight.
- Weights are remembered for that playlist the next time the page opens.
- It works and is comfortable to use on a phone browser.

## Scope

**In scope (v1)**
- Load a YouTube playlist (up to 200 videos) and add single videos on top.
- Whole-number weights per song, and a weighted loop built from them.
- End-of-loop behaviour toggle: new shuffle / stop.
- Play, pause, next, previous, play-now, up-next preview.
- Weights and extra videos saved in the browser, per playlist.
- Responsive layout, light and dark themes.
- The crew: a pen of walking creatures, one per song, that hatch and grow as songs are played (session only).
- Footer with the owner's credit and the Kenney art credit.

**Out of scope (v1)**
- Section loops (A–B), per-song repeat counts, sleep timer.
- Background playback on phones (not possible for a web page using YouTube's embedded player without working around YouTube Premium; will not be built).
- Sync across devices, sign-in, YouTube Data API key.
- Hosting on the internet.

**Possible later add-ons** (the design keeps room for these without restructuring)
- "Open this loop in YouTube" button using `youtube.com/watch_videos?video_ids=…`. Undocumented; needs a test for duplicates and length limit first.
- Hosting on a static host (for example Vercel) so it works away from home Wi-Fi.
- Document Picture-in-Picture on desktop Chrome/Edge. Needs HTTPS (so hosting) and a test that the embedded player keeps playing in the PiP window.
- A YouTube Data API key for playlists over 200 videos.

## How it runs

- Plain HTML, CSS and JavaScript (ES modules). No build step and no dependencies.
- Started with `python3 -m http.server 8000` from the project folder, then opened at `http://localhost:8000`. The YouTube player does not work reliably from a `file://` page.
- A phone on the same Wi-Fi opens `http://<computer's local IP>:8000`.
- Phone browsers need one tap on Play before playback starts, and usually pause when the screen locks. The page cannot change either.

## Structure

```
weighted-playlist/
  index.html      page layout
  styles.css      responsive layout and themes
  app.js          wires everything together and updates the screen
  links.js        works out what a pasted link points to
  weights.js      weights → plays per loop and plain-language frequency
  rotation.js     builds each loop: plays → spaced-out order
  storage.js      saves and loads settings in the browser
  youtube.js      wraps YouTube's IFrame Player API and oEmbed title lookups
  crew.js         crew rules: play counting, hatch/grow/revert, pen limit (no DOM)
  crew-view.js    draws the pen and moves the creatures
  assets/kenney/  the 47 creature SVGs used from Kenney's New Platformer Pack, plus its License.txt
  tests/          automated tests for links.js, weights.js, rotation.js and crew.js
  docs/           this spec and the mockup
```

`links.js`, `weights.js`, `rotation.js` and `crew.js` are pure logic with no browser or YouTube dependencies, so they can be tested with Node's built-in test runner (`node --test`). `youtube.js` is the only file that talks to YouTube, so a later PiP or export feature touches it and `app.js` only.

## Links

The top bar accepts playlist and video links. The bottom box in the song list accepts single video links only.

`links.js` classifies a pasted link by its shape, with no network call:

| Link | Result |
|---|---|
| `youtube.com/playlist?list=L` | playlist `L` |
| `youtube.com/watch?v=V`, `youtu.be/V`, `/shorts/V`, `/live/V`, `/embed/V` | video `V` |
| `watch?v=V&list=L` | both: ask the user |
| `watch?v=V&list=RD…` (a video opened from a YouTube Mix) | video `V` (the Mix is ignored) |
| anything else | invalid |

- `www.`, `m.` and `music.` host variants are accepted, as are links pasted without `https://`.
- Top bar, playlist: the button reads **Load**, and the list is replaced by the playlist.
- Top bar, video: the button reads **Add** while that link is in the field, and the video is added at weight 1. If no playlist is loaded, a new list called "My rotation" starts with it.
- Top bar, both: the page offers **Load the whole playlist** or **Add just this video**.
- Bottom box, playlist link: message "That's a playlist link. Paste it in the top bar to load it."
- Invalid: message explaining that a YouTube playlist or video link is expected.
- YouTube Mix links (`list=RD…`) may not load in the embedded player. This gets tested during implementation; if they don't load, the page says so clearly.

## Loading a playlist

1. The YouTube IFrame player cues the playlist by ID (`cuePlaylist({listType: 'playlist', list})`), then `getPlaylist()` returns its video IDs. (Documented in the [IFrame Player API reference](https://developers.google.com/youtube/iframe_api_reference). A 200-video cap is reported by others but not documented.)
2. Song titles and channel names come from YouTube's oEmbed endpoint (`https://www.youtube.com/oembed?url=…&format=json`), one request per video, a few at a time. No API key is needed; the endpoint allows requests from a local page (checked with `localhost`).
3. The playlist title and owner come from the same oEmbed endpoint with the playlist URL (checked: it returns the playlist's title and channel).
4. Saved weights and extra videos for that playlist are applied. Songs no longer in the playlist are dropped from storage.
5. The last playlist used reopens automatically next time.

## Weights

- Every song has a whole-number weight from **1 to 99**, default **1**. There is no 0: every song plays at least once per loop.
- A song's share is its weight divided by the total of all weights.
- **Plays per loop:** each weight divided by the greatest common divisor of all weights. Loop length is the sum. Example: weights 4, 2, 2, 2 → plays 2, 1, 1, 1 → loop of 5.
- Unplayable songs are excluded from the loop and the totals. A song is only known to be unplayable once the player reports an error for it; from then on (for the session) it is marked and the rest of the loop is rebuilt without it.

### How frequency is shown

Each song shows a bar (its share) and a plain-language line. No percentage text.

With `c` plays in a loop of `len`, and `n = len / c`:

| Condition | Text |
|---|---|
| `c = len` | Every song |
| `n` is a whole number | 1 in every `n` songs |
| `n < 2.5` | `c` in every `len` songs |
| otherwise | About 1 in every `round(n)` songs |

The list header shows `{songs} songs · {len} plays per loop`.

## Rotation

### Building a loop

1. For each song with `c` plays, pick a random offset `r` in [0, 1) and place its plays at positions `(k + r) / c` for `k = 0 … c-1`.
2. Sort every play by position. This spreads each song's plays evenly and changes the order every loop.
3. Clean-up pass: where a song would play twice in a row, swap the second one with a later play that doesn't create a new back-to-back repeat. The first song of a new loop is also checked against the last song played.
4. When one song dominates (for example weight 20 among ten songs at 1), some back-to-back plays can't be avoided. That is accepted.

### End of loop (icon toggle, with tooltips)

| Icon | Tooltip | Behaviour |
|---|---|---|
| shuffle arrows | New shuffle each loop | build a new loop (default) |
| square | Stop after this loop | stop when the loop ends |

Tooltips show on hover or keyboard focus; on touch screens, tapping an icon selects it and shows the tooltip for about 1.5 seconds. The choice is saved.

### Playback

- After a playlist loads (or the first video is added), the first song of the loop waits in the player, paused (`cueVideoById`), so Play starts it. The video box says "Paste a playlist link above, then press play." only when nothing is loaded, and "Press play to start." when a list is loaded but nothing is waiting.
- **Play/pause**, **next**, **previous** (goes back through what actually played), **play now** (tap a song's title).
- Advances automatically when a song ends (player state `ENDED`).
- **Up next** shows the next four songs, with a "new loop" marker where a loop ends.
- The player shows `Loop {n} · {position} of {len}`.
- **Changing a weight** keeps the current song playing and rebuilds the rest of the loop right away.
- **Play now** plays the chosen song and starts a new loop after it.

## Screen

The mockup is the reference for layout and copy.

- **Header, centred and stacked:** the name **heavy rotation** (*heavy* in extra-bold accent colour, *rotation* in a light weight), then the description, then the link bar.
- **Description:** "Give your favourites more airtime. Turn up the songs you love, and they come around more often while the rest of the playlist stays in the mix."
- **Desktop:** player and controls on the left (stays in view while scrolling), song list on the right.
- **Phone:** stacked; the player and controls stay pinned at the top while the list scrolls.
- **Song list header:** playlist title and owner, `{songs} songs · {len} plays per loop`, and a **Weight ⓘ** label. The ⓘ tooltip reads: "The heavier the weight, the more often a song comes around." Hover or focus shows it; on phones, tap to open and tap elsewhere to close.
- **Song row:** title and channel (tap to play now), a `−` / number / `+` weight control sized for thumbs (number can be typed), the share bar and frequency line. The playing song is highlighted with a "Now" badge.
- **Removing:** each row has a × button. The song leaves the list; a note says "Removed <title>." with **Undo**. Removed playlist songs stay out when the playlist is read again (saved as `removed`); pasting a removed song's link brings it back. A playing song that is removed finishes, then the loop continues without it. Nothing changes on YouTube (editing the YouTube playlist would need Google sign-in; out of scope).
- **Hover:** rows tint on hover, the title underlines, and a ▶ appears over the thumbnail (also on keyboard focus).
- **Sorting:** by weight, highest first, then by title. Re-sorts about a second after the last weight change so rows don't jump while tapping; the moved row briefly highlights.
- **Themes:** light and dark, following the system setting.

The mockup's "Mockup" banner, "Try a sample link" buttons, 8-second simulated songs, 3-second hatch time and "fast-forward 12 songs" button are mockup-only and are not part of the app.

- **Footer:** reuses the `4benies-tracker` footer style (small, centred, muted, top border): "made with love by twitter user @mintbluetoyota." (linked to https://x.com/mintbluetoyota) and "creatures by Kenney." (linked to https://kenney.nl).

## The crew

A box under the player (**The crew**) where small creatures walk around, one per song, in the spirit of the VS Code pets extension. It is for fun only and resets on refresh.

### Art

- Kenney's **New Platformer Pack** (CC0; `License.txt` in the pack says "Creative Commons Zero, CC0"), downloaded by the owner. Only the 47 SVG frames the crew uses are kept, in `assets/kenney/` with the pack's `License.txt`.
- **10 creature models:** astronaut, slime, spike slime, block slime, snail, ladybug, mouse, worm, frog, bee.
- **Frames per model:** idle, walk A, walk B, and rest. The frog's walk frames are idle and jump; the astronaut's rest frame is its crouch.
- **Colour variants:** the astronaut uses the pack's 5 colours; the other models use 5 hue shifts (0°, 70°, 150°, 220°, 300°).
- **Which creature a song gets** is worked out from its video ID (a hash picks the model and variant), so a song always gets the same creature.
- Credit in the footer: "creatures by Kenney" (not required by CC0, included anyway).

### How plays count

- **When a song starts playing:** if its creature isn't in the pen, it hatches. If it is, it evolves: a white flash, a sparkle burst, and it grows one size step.
- **The play counts after 30 seconds of actual playback** (time paused doesn't count). Each play of a song counts at most once.
- **Skipping before 30 seconds reverts the play:** a newly hatched creature poofs away; an existing creature shrinks back to its previous size.
- **Size:** 26 px at 1 play, +7 px per play, up to 96 px. Bigger creatures walk a little slower.
- **Points are session only.** Nothing is saved; a refresh starts with an empty pen.

### The pen

- Holds up to **20** creatures. A new creature can briefly be the 21st; when its play counts, the smallest creature (fewest plays, then least recently played; never the current song's) walks out of the pen.
- When the pen is full, the header reads **"Your top 20 songs"**. Otherwise it shows only the title.
- Empty state: "Press play and your songs show up here."
- Each creature has a small tag with its song title.
- **Hover** (or tap on phones, shown for about 2 seconds) shows the song title and "Played 1 time" / "Played X times".
- No floating words: no "hatched", "+1" or "evolved" text.

### Movement

- Creatures wander left and right, stop, and turn, at three depths so they overlap less. Walking alternates the two walk frames with a slight bob; the frog hops; the bee flaps and floats.
- **Current song:** its creature walks like the others, with an accent-coloured outline and musical notes (♪ ♫) floating up from it. No dancing.
- **Paused:** every creature freezes in place (movement, frame animation and notes) and carries on when playback resumes.
- Respects "reduce motion": creatures stay still.
- On phones, the pen sits under the pinned player and scrolls with the page.

## Storage

`localStorage`, one entry per playlist plus app settings:

```json
{
  "hr:playlist:<listId>": {
    "weights": { "<videoId>": 4 },
    "extras": ["<videoId>"],
    "removed": ["<videoId>"]
  },
  "hr:settings": {
    "lastSource": { "type": "playlist", "id": "<listId>" },
    "endMode": "shuffle"
  }
}
```

- Weights of 1 are not stored. Songs removed from the playlist are dropped.
- A list started from single videos uses `hr:playlist:mine`.
- Every read and write is wrapped in `try/catch`. If storage is unavailable, everything still works for the session and a small note says weights won't be remembered.

## Errors

| Situation | What the user sees |
|---|---|
| Link isn't YouTube | "That doesn't look like a YouTube link…" with what's expected |
| Playlist private, deleted or empty | "Couldn't load this playlist. It may be private or deleted." |
| Video can't be embedded (errors 101, 150) | Row marked **Can't play here**, skipped automatically |
| Video removed or private (error 100) | Same as above |
| Every song unplayable | Playback stops with a message |
| Title lookup fails | The row shows the video ID; the song still plays |
| YouTube player script fails to load | "The YouTube player couldn't load. Check your connection or ad blocker." |
| Storage unavailable | Small note: weights won't be remembered |

## Testing

**Automated (`node --test`)**
- `links.js`: every link shape in the table above, host variants, missing scheme, invalid input.
- `weights.js`: plays per loop including divisor reduction; frequency text for each rule.
- `crew.js`: a play shows immediately but counts only after 30 s of playback; paused time doesn't count; skipping before 30 s reverts (new creature removed, existing one back to its previous size); pen limit and eviction order; the current song's creature is never evicted; the same video ID always maps to the same model and variant.
- `rotation.js`: each song appears exactly its number of plays; no back-to-back repeats where avoidable (checked over many random loops); no repeat across the join between loops; a saved end mode that no longer exists falls back to new shuffle.

**Manual, in a real browser**
- A real playlist loads, and titles and the playlist name appear.
- Songs advance automatically at the end.
- A video with embedding turned off is marked and skipped.
- Weights survive a page reload.
- The layout and controls work on a phone over Wi-Fi.
- Whether a Mix (`RD…`) link loads.
- The crew: hatch, grow, revert on early skip, freeze on pause, outline and notes on the current song.
