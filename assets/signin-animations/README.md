# Sign-in carousel slides

The animated three-slide sign-in carousel. Each `slideN.html` is a self-contained
animation rendered in a `react-native-webview`, hosted by
`src/screens/auth/SplashScreen.tsx` (a `FlatList` pager) via
`src/components/auth/AnimatedSlide.tsx`.

This directory is a **contract**, not a free-form export. A slide drops in if and
only if it honours the contract below; `scripts/validate-signin-slides.js`
(npm run `validate:slides`, also enforced in CI) fails the build otherwise.

## Files

| File | What |
|------|------|
| `slide1.html` | Post a request → Discover (merged two-scene timeline). 25600ms. |
| `slide2.html` | Trade points. 10000ms. |
| `slide3.html` | Earn points on your schedule (embeds a looping `<video id="bowls">`). 8058ms. |
| `press-for-2x.png` | The "press for 2x" affordance note (overlaid by the host, not part of a slide). |

## The slide contract: `window.__slide`

Every slide exposes exactly one global and nothing else the host needs to know
about:

```js
window.__slide = {
  durationMs,        // canonical single-play length (ms). MUST equal this
                     // slide's durationMs in SplashScreen.tsx's SLIDES table.
  play(),            // start / resume from the current position
  pause(),           // freeze in place
  seek(ms),          // set position (0 = the very beginning)
  setRate(multiplier), // 1 = normal, 3 = press-and-hold fast-forward
  onFrame(cb),       // cb(currentMs) each frame — drives the host's progress ring
};
```

It is implemented by driving `document.getAnimations()` as one group through the
Web Animations API. A single internal `requestAnimationFrame` master clock is the
**only** timing authority: it advances by `rate`, loops at `durationMs` by
rewinding every animation to `currentTime = 0`, and reports the clock through
`onFrame`. There is no `animationName`-clearing reset, no reflow trick, and no
virtualized `setInterval`.

The host calls **only** this contract:

- activate → `__slide.seek(0); __slide.play()`
- deactivate → `__slide.pause(); __slide.seek(0)`
- hold / release → `__slide.setRate(3 | 1)`
- progress ring → `__slide.onFrame(currentMs)` against `durationMs`

## Authoring rules (enforced by the validator)

1. **Design frame.** One outer `540×1173` container tagged `data-slide-root`
   (the host appends the progress-ring SVG to it).
2. **Contract.** Implement `window.__slide` with all six members and a numeric
   `var DURATION` equal to the slide's `durationMs` in `SplashScreen.tsx`.
3. **Single play-through.** One finite timeline — **no `infinite` animations** and
   no `forwards` end-frame hold that can strand the slide; the master clock loops
   it cleanly from `t = 0`.
4. **Zero external requests.** Embed everything — images as WebP (q≈85, downscaled
   to ≤3× their on-frame display size), the font as a base64 `@font-face`, and any
   video inline. No `fonts.googleapis.com`, no remote `src`/`url(...)`. (An SVG
   `xmlns="http://www.w3.org/2000/svg"` is a namespace, not a request, and is
   allowed.)
5. **Budget.** Keep each slide under ~1.6 MB.

## Adding a 4th slide

Author a contract-compliant `slide4.html`, drop it in this directory, and append
one entry to the `SLIDES` table in `SplashScreen.tsx`
(`{ key, source: require('.../slide4.html'), durationMs }`). No host changes are
needed. Run `npm run validate:slides` before committing.

