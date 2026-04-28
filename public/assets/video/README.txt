Place looping MP4 files here (Next.js serves `public/` at the site root):

- background.mp4        -> /assets/video/background.mp4
- background_slow.mp4   -> /assets/video/background_slow.mp4
- background_edm.mp4    -> /assets/video/background_edm.mp4

Tips:
- Keep files short (10-30s) and loop-friendly (match first/last frame).
- H.264 + AAC, ~720p or 1080p, moderate bitrate for mobile.
- The app dims and blurs video in CSS so tiles stay readable.

Current fallback in code (works even with no local files):
- emotional/pop/latin: https://raw.githubusercontent.com/mdn/interactive-examples/main/live-examples/media/cc0-videos/flower.mp4
- edm: https://raw.githubusercontent.com/mdn/interactive-examples/main/live-examples/media/cc0-videos/friday.mp4

These come from MDN interactive examples (CC0 video samples). Replace with your own
local `/assets/video/*.mp4` files any time for full visual control.

Neon-cinematic look is currently achieved with CSS color grading and animated light
overlays in `app/page.tsx` + `app/globals.css` (license-safe, no extra assets needed).
