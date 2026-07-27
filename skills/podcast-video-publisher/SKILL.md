---
name: "Podcast Video Publisher"
description: "Render podcast episodes as 1080p art-slideshow MP4s and publish them to a YouTube Podcasts playlist: covers/thumbnails from your art, resumable batch upload, playlist ordering, retiring old versions. Use when releasing podcast episodes to YouTube, batch-upgrading existing episode videos, rebuilding a podcast playlist, or debugging YouTube API upload/thumbnail/playlist failures."
---

# Podcast Video Publisher

Turn a folder of podcast audio + a folder of artwork into a complete,
correctly-ordered YouTube Podcasts section. Built for Ghost Signals with
Kannaka (season 1: 12 episodes in one day); reusable for any show.

## What This Skill Does

1. **Render** — `scripts/podcast-slideshow.py` builds a 1920×1080 MP4 per
   episode: art slides (~45 s each, blur-filled background, sharp center
   panel, dip-to-black fades) plus a generated cover card (hero art +
   episode title) that doubles as the thumbnail. Video is padded then
   muxed `-shortest`, so A/V drift is 0.00 s by construction.
2. **Publish** — `scripts/podcast-upload-batch.js` runs resumable phases:
   `upload → thumbs → playlist → order → retire → verify`, with all
   progress in a state file so any failure (quota, rate limit, network)
   resumes exactly where it stopped.
3. **Self-heal** — `scripts/podcast-finisher.js` is a long-running watcher
   that retries rate-limited thumbnails (2 h cadence) and applies playlist
   positions the moment position updates become possible.

## Prerequisites

- ffmpeg + ffprobe on PATH; Python 3 with Pillow; Node 18+
- YouTube OAuth credentials at repo root `.youtube.json` with the full
  `youtube` scope (create via `scripts/youtube-grant.js`; never commit it)
- Fonts: defaults use Segoe UI (`C:/Windows/Fonts/segoeui*.ttf`) — edit
  `FONT_BOLD`/`FONT_REG` in `podcast-slideshow.py` on Linux/macOS
- Artwork: square images (≥1024 px) in `workspace/podcasts/art/` with a
  `manifest.json` array of `{ "file": "...", "title": "..." }`

## Quick Start

```bash
# 1. Describe the season
$EDITOR workspace/podcasts/episodes.json
# [ { "num": 1, "title": "Hello World", "audio": "<abs path to mp3>" }, ... ]

# 2. Render everything (idempotent; --force re-renders)
python scripts/podcast-slideshow.py --all

# 3. Write workspace/podcasts/metadata.json
# [ { "num": 1, "title": "<video title>", "description": "...", "tags": [...],
#     "video": "<renders/GSP-001-slideshow.mp4>", "cover": "<renders/GSP-001-cover.png>",
#     "oldVideoId": "<optional: existing video this replaces>" }, ... ]

# 4. Point the pipeline at your podcast playlist
#    (edit PODCAST_PLAYLIST in scripts/podcast-upload-batch.js)

# 5. Publish — safe to re-run until it prints "all phases complete"
node scripts/podcast-upload-batch.js

# 6. If thumbnails or ordering are still pending, leave the watcher running
node scripts/podcast-finisher.js
```

## Phase Reference (`podcast-upload-batch.js`)

| Phase | What it does | Quota |
|-------|--------------|-------|
| `upload` | `videos.insert` per episode, missing-episodes first | 1600/video |
| `thumbs` | `thumbnails.set` with the rendered cover | ~50 |
| `playlist` | remove stale items, insert episodes into the podcast playlist | 50/item |
| `order` | `playlistItems.update` explicit positions 1→N | 50/item |
| `retire` | unlist each replaced video + prepend an "upgraded edition" pointer to its description (old links keep working) | 50/video |
| `verify` | read back playlist order + processing status of every upload | ~1 |

Run one phase with `--phase <name>`. State lives in
`workspace/podcasts/upload-state.json`; delete an entry to force a redo.

## YouTube Gotchas (all hit in production — trust these)

1. **Uploads can silently vanish.** `videos.insert` may return 200 + a
   video ID and the video is simply gone minutes later — no error, no
   `rejectionReason`. Always re-verify IDs with `videos.list` before
   playlist adds (which otherwise fail "Video not found"), and keep
   uploads resumable per-item. Re-uploading the identical file works.
2. **Thumbnails: 2 MB hard limit + long rate-limit.** 1080p PNGs blow the
   2,097,152-byte cap (`413`) — save covers as JPEG quality ~88. After
   ~10 rapid sets you get `429 "too many thumbnails recently"` and the
   cooldown outlasts 40+ minutes — hence the finisher's 2 h retry cadence.
3. **Podcast playlists force publish-date ordering.** Display order is
   exactly `publishedAt DESC`; insert order is irrelevant, delete +
   re-insert changes nothing, and `playlistItems.update` with a position
   fails with *"Playlist sort type need to be MANUAL to support
   position"*. `publishedAt` is immutable (a private→public round-trip
   does NOT reset it) and the sort setting is not in the Data API. Fix:
   flip the playlist to **Manual** ordering in YouTube Studio (one click,
   owner only), then run `--phase order`. Or upload in episode order in
   the first place.
4. **Daily quota is not always 10k.** A 13-upload day (~21k nominal
   units) cleared fine. Don't pre-abort on quota math, but assume any
   phase can die mid-run — that's what the state file is for.

## Design Notes

- Cover cards are drawn with Pillow (hero art right, blurred/darkened
  art as backdrop, kicker + wrapped title + footer left) — consistent
  branding and readable at thumbnail size.
- Slides are rendered as independent per-slide MP4 segments (parallel,
  resumable) and joined with the concat demuxer; audio is muxed once at
  the end, so chapter timestamps in descriptions stay valid.
- Keep `episodes.json`, `metadata.json`, and `upload-state.json` out of
  version control (they carry machine-local paths and run state); commit
  only the three scripts.
- Descriptions: keep every factual claim traceable to the episode audio
  (transcribe with faster-whisper if needed), and scrub anything private
  before publishing — no server names, IPs, file paths, or credentials.
