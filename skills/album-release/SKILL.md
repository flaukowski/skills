---
name: "Album Release Pipeline"
description: "Ship a complete album in one run: write or reuse lyrics, render tracks, generate one cover per song, build a 1080p album film with karaoke subtitles, publish the video, deploy the audio to a radio host, and premiere it on air. Use when releasing a new album, re-running a failed phase, or timing an on-air premiere."
---

# Album Release Pipeline

One config file in, a released album out: audio, art, film, video
publish, radio deploy, on-air premiere, social announce.

The pipeline is phase-based and every phase is idempotent — re-run after
any failure and it resumes where it stopped. Proven end-to-end: a
seven-song album went from blank page to on-air premiere in about two
and a half hours.

> The release runner itself is operator-specific: it is wired to a
> particular radio host, credential layout, and set of provider accounts.
> This skill documents the shape of the pipeline and the failure modes
> worth knowing. Supply your own runner and provider credentials.

## Phases

1. **Music** — render each track through your music provider in custom
   mode, two variants per track, resumable via a per-track ledger so a
   mid-album failure never re-renders what already succeeded.
2. **Art** — generate one cover per track from a per-track art prompt,
   then collect the images.
3. **Film** — fetch timestamped lyrics, emit per-track ASS karaoke
   subtitles, and assemble a 1920×1080 slideshow (one cover per song,
   lyrics burned in) with ffmpeg.
4. **Publish** — upload the film, deploy the audio to the radio host,
   restart the service, and fan out the announce post.

## Config shape

A single JSON file drives the run:

- `name`, `out_dir`, `ledger`, `theme`, `default_style`
- `tracks[]` — each with `title`, `style`, `art_prompt`
- `release{}` — lead track, video metadata, and the deploy target

Register the album with the radio's programming layer before deploying,
since the deploy phase pulls the album definition on the host. A preflight
check should abort when the album is not registered — that one mistake
otherwise surfaces as a silent no-op an hour later.

**Lyrics**: pre-write them. Drop a lyrics file per track in `out_dir`
before running, and the pipeline uses it verbatim; otherwise it generates
them. Hand-written lyrics are almost always the better album.

## Phase gating

Skip phases you want to control by hand — this is how you time a premiere:

1. Run with the deploy and announce phases skipped.
2. Deploy the audio early by hand. Deploy normally runs *after* the art
   phase (~9 minutes), so if you are racing a clock, move the files
   yourself, renamed to the exact track titles.
3. Fire the showcase ceremony against the radio's album-showcase endpoint
   with the album name, a duration, and the real making-of story — the
   narration is built from that story, so a vague one produces vague
   narration.

To sync with a scheduled segment, watch the radio journal for the segment
marker and fire after it. If strict ordering matters, wait for the
segment's *completion* marker rather than its start — a slow segment can
otherwise be stepped on by the showcase intro.

## Gotchas (each one caused a real fire)

- **Windows paths**: pass the config as a `C:/...` style path. Embedded
  Python rejects MSYS `/c/...` form and the builder silently no-ops.
- **Apostrophes**: album-level `theme` and `default_style` get
  interpolated into single-quoted inline Python — keep them
  apostrophe-free. Per-track fields and lyrics are safe.
- **Art prompts**: diversify medium, palette, and subject across the
  batch or the image provider's repetition detector will start rejecting
  requests. One distinct medium per song works well — linocut,
  screenprint, gouache, oil, travel poster, ink, digital.
- **Video uploads**: verify the upload actually exists afterwards rather
  than trusting the response. Uploads can vanish after a 200.
- **One-shot narration**: if a scheduled segment's TTS fails, it may post
  its text and mark itself complete with no retry. The album premiere is
  unaffected, but that segment goes silent for the slot.
- **Remote work**: batch it into few sessions. Connection churn trips
  fail2ban-style protections on most hosts, and SSH connection multiplexing
  does not work from Windows OpenSSH.

## Related

- Sibling skill: `podcast-video-publisher` — episode videos and playlist
  management.
