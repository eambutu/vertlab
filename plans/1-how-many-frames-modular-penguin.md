# Plan: Fix "video won't play after stepping backward"

## Context

Users report that clicking the back-frame button can leave the player in a
state where the video no longer plays.

**Root cause — a `play()`/seek race.** In `src/app/components/analyzer.tsx`,
`stepFrame` (and the scrubber `Slider`) seek by setting `video.currentTime`
through `seekTo` (`analyzer.tsx:117`). `seekTo` is called only by those two
manual paths (`analyzer.tsx:130` and the slider `onValueChange` at `:241`);
`detectFps` sets `currentTime` directly and does not use it. `togglePlay`
(`analyzer.tsx:135`) calls `v.play()`, which returns a promise that stays
*pending* until playback actually starts. If a seek runs during that pending
window (e.g. press Play, then immediately step back), the browser **aborts the
pending `play()`** and leaves the video paused/stuck. It surfaces on backward
stepping because that's the natural action right after pressing Play; forward
stepping and scrubbing share the same race.

Outcome: stepping/scrubbing never leaves playback in a broken state, and Play
reliably resumes afterward.

## Implementation

Single file: `src/app/components/analyzer.tsx`.

- In `seekTo`, pause the video before setting `currentTime`:
  ```ts
  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause(); // avoid racing an in-flight play() promise; stepping is a paused action
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
  }, []);
  ```
- This covers both callers (frame stepping and slider scrubbing) in one place.
  `playing` state stays correct because the `<video>` `onPause` handler
  (`analyzer.tsx:213`) flips it, so the Play/Pause button label matches reality.
- No change needed to `togglePlay` (its `play().catch(() => {})` already swallows
  any residual AbortError) or to `detectFps`.

## Verification
1. In the running preview, upload a video.
2. Press **Play**, then immediately click **‹ back frame** (and **⟪ back 5**).
   Video should pause on the target frame — not enter a stuck state.
3. Press **Play** again: it resumes normally. Repeat several times rapidly.
4. Repeat the press-Play-then-step test with the **forward** buttons and by
   dragging the **scrubber** — all should end paused and replay cleanly.
5. Confirm normal playback (Play → let it run → Pause) still works, and the
   button label tracks the actual play state.

---

# Plan: Analysis "modes" beneath keyframes (Approach Jump)

> NOTE: The sections further below describe earlier, already-implemented tasks
> (jump-height card, FPS detection, vertical video). This top section is the
> current request.

## Context

Today the only analysis is the two-frame **comparison** that appears when you
select exactly two keyframes (`analyzer.tsx:312`, rendering `DiffPanel`). The
user wants **analysis modes** that instead assume a fixed structure across the
captured keyframes. The first (and only, for now) mode is **Approach Jump**,
which assumes the first three keyframes (in time order) are:

1. first ground contact,
2. first leaving the ground (takeoff),
3. landing again.

It reports **ground contact time** (takeoff − contact) and **jump height**
(from the airtime landing − takeoff, reusing existing physics). The mode UI is
**disjoint** from the two-frame comparison — a row of mode buttons sits beneath
the keyframe strip, and activating a mode replaces the comparison view.

Decision (confirmed with user): Approach Jump always uses the **first 3 captured
keyframes in time order** and ignores strip selection. Design is kept extensible
for future modes (e.g. 10-5 RSI).

## Implementation

### 1. Mode registry — `src/app/components/modes/index.ts` (new)
Define an extensible registry so future modes are a one-line add:
```ts
export interface AnalysisMode {
  id: string;
  label: string;
  minFrames: number;
  Panel: React.ComponentType<{ keyframes: Keyframe[] }>;
}
export const MODES: AnalysisMode[] = [approachJumpMode];
```
Register `approachJumpMode` = `{ id: "approach-jump", label: "Approach jump", minFrames: 3, Panel: ApproachJumpPanel }`.

### 2. Approach Jump panel — `src/app/components/modes/approach-jump-panel.tsx` (new)
- Props: `{ keyframes: Keyframe[] }`. Keyframes arrive already sorted by time
  (maintained in `analyzer.tsx` on capture), so use `keyframes[0..2]`.
- Guard: if fewer than 3, render a short "Capture at least 3 keyframes" note.
- Compute:
  - `contactMs = (kf[1].time - kf[0].time) * 1000`
  - `airtime = kf[2].time - kf[1].time`
  - `jumpIn = jumpHeightInches(airtime)` — reuse `src/app/lib/video-utils.ts`.
- Display two result cards (reuse the styling of the existing jump card in
  `diff-panel.tsx`): **Ground contact time** (`formatTimecode`/ms via
  `preciseMs`) and **Jump height** (`${jumpIn.toFixed(2)} in`).
- Show the three frames as labeled thumbnails: **Contact → Takeoff → Landing**
  (same thumbnail treatment as `diff-panel.tsx` FrameCard: `object-contain` on
  black). Add a subtle note that it uses the first 3 keyframes.

### 3. Wire modes into `src/app/components/analyzer.tsx`
- New state: `const [activeMode, setActiveMode] = useState<string | null>(null)`.
- **Mutual exclusion (disjoint UI):**
  - Selecting a frame (`toggleSelect`) also clears the mode: `setActiveMode(null)`.
  - Activating a mode clears selection: `setSelected([])`.
- **Mode bar** beneath the `KeyframeStrip` section (after `analyzer.tsx:309`):
  render a button per `MODES` entry; `variant` toggles `default`/`outline` on
  active; `disabled` when `keyframes.length < mode.minFrames` with a tooltip
  ("Needs N keyframes").
- **Render logic** (replace the current diff block at `analyzer.tsx:311-317`):
  - if `activeMode` → render that mode's `Panel` with `keyframes`.
  - else if `selectedFrames.length === 2` → render existing `DiffPanel`.
- Update the keyframes header hint (`analyzer.tsx:295-301`) so it doesn't imply
  comparison is the only path when a mode is active (minor copy tweak).

## Critical files
- `src/app/components/modes/index.ts` — new registry.
- `src/app/components/modes/approach-jump-panel.tsx` — new panel.
- `src/app/components/analyzer.tsx` — `activeMode` state, mode bar, mutual
  exclusion, conditional render.
- Reused: `jumpHeightInches`, `formatTimecode`, `preciseMs`
  (`src/app/lib/video-utils.ts`); thumbnail/card styling from `diff-panel.tsx`.

## Verification
1. Open the running preview; upload a video.
2. Capture 3 keyframes at: foot contact, takeoff, landing.
3. Beneath the strip, the **Approach jump** button should be enabled (disabled
   with a tooltip when < 3 keyframes exist). Click it.
4. Confirm the comparison UI is hidden and the Approach Jump panel shows:
   Contact/Takeoff/Landing thumbnails, a **ground contact time** (≈ takeoff −
   contact), and a **jump height** in inches (2 dp) matching
   `jumpHeightInches(landing − takeoff)` — sanity: 0.50 s airtime ≈ 12.07 in.
5. Confirm disjointness: selecting two frames while the mode is active switches
   back to the comparison (mode deactivates), and re-activating the mode clears
   the selection.

---

# Plan: "Jump height" readout for the frame comparison

## Context

When two keyframes are being compared, the diff panel already shows the exact
time delta between them (`deltaMs` in `src/app/components/diff-panel.tsx:21`).
The user wants a playful physics readout: interpret that time gap as the
**hang time of a vertical jump** and show how many inches you'd have jumped,
to two decimal places.

Physics: for an object in free fall launched straight up, total airtime `t`
relates to peak height by `h = g · t² / 8` (since time-to-apex is `t/2` and
`h = ½·g·(t/2)²`). Using `g = 9.81 m/s²` and converting metres → inches
(`× 39.3701`):

```
heightInches = (9.81 * t^2 / 8) * 39.3701   // t in seconds
```

Outcome: a small, clearly-labeled card in the comparison view showing the
implied vertical-jump height in inches (2 dp), derived from the existing
`deltaMs`.

## Implementation

All changes in `src/app/components/diff-panel.tsx`; one small helper in
`src/app/lib/video-utils.ts`.

1. **Helper** (`video-utils.ts`): add
   `jumpHeightInches(airtimeSeconds: number): number` implementing the formula
   above. Pure function, easy to unit-check.
2. **UI** (`diff-panel.tsx`): compute `const jumpIn = jumpHeightInches(deltaMs / 1000)`
   (reuse the existing `deltaMs`). Add a labeled card — reuse the existing
   `Stat` sub-component pattern already in this file, or a small dedicated card
   near the delta pill / alongside the "Pixels changed" / "Avg intensity" stats.
   - Label it clearly as a fun/derived metric, e.g. "Vertical jump (hang time)".
   - Value: `` `${jumpIn.toFixed(2)} in` ``.
   - Import an appropriate `lucide-react` icon (e.g. `ArrowUp` or `Rocket`) in the
     existing import on line 2 for a little flair (optional).

## Verification
1. Open the running preview; upload a video and capture two keyframes.
2. Select both to open the comparison. Confirm a "Vertical jump" card appears
   showing inches to 2 dp.
3. Sanity-check the math against the delta: e.g. a **0.50 s** gap →
   `9.81 * 0.25 / 8 * 39.3701 ≈ 12.07 in`; a **1.00 s** gap → `≈ 48.28 in`.
   Pick two frames whose delta is near these values and confirm the number is in
   the right ballpark.

---

# Plan: True per-frame stepping (FPS detection) + vertical video support

## Context

Two issues with the Keyframe Inspector's player (`src/app/components/analyzer.tsx`):

1. **Frame stepping is imprecise.** The ◀/▶ arrows jump `1 / ASSUMED_FPS` where `ASSUMED_FPS` is hardcoded to `30` (~33.3 ms per press). On a 24fps, 25fps, or 60fps clip this does not equal one frame, so "step a frame" is wrong and stepping drifts. The user wants the most granular stepping possible: detect the video's actual frame rate and advance by exactly one real frame.

2. **Vertical (portrait) videos are broken.** The `<video>` is locked to a fixed `aspect-video` (16:9) box. A `<video>`'s default `object-fit` is `fill`, so portrait footage is stretched/distorted. Keyframe thumbnails (`keyframe-strip.tsx`) and diff frame cards (`diff-panel.tsx`) use `aspect-video object-cover`, which crops portrait frames. The diff *math* already adapts (it derives height from the real `videoWidth/videoHeight`), so this is purely a display problem.

Outcome: arrows step exactly one frame at the video's true rate (with a visible, user-overridable FPS), and portrait/square/landscape videos all display correctly end to end.

## Part 1 — Detect FPS and step by one true frame

All in `src/app/components/analyzer.tsx`.

### Detect the frame rate via `requestVideoFrameCallback`
- Add a `detectFps(video): Promise<number>` helper (module-level, in `analyzer.tsx` or `lib/video-utils.ts`).
- If `'requestVideoFrameCallback'` is **not** on the video element, resolve to `30` (fallback).
- Otherwise: briefly play the video **muted** from the start, register `requestVideoFrameCallback`, and collect `metadata.mediaTime` for ~20–30 presented frames. Compute the deltas between consecutive `mediaTime` values, take the **median** delta, and `rawFps = 1 / median`.
- Snap `rawFps` to the nearest common rate from `[23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120]` when within a small tolerance; otherwise keep `Math.round(rawFps * 100) / 100`.
- When detection finishes: pause, restore `currentTime` to where it was (≈ 0), and store the value.

### State + UI
- Replace the `ASSUMED_FPS` constant usage with React state: `const [fps, setFps] = useState(30)` and `const [detecting, setDetecting] = useState(true)`.
- Kick off `detectFps` from the existing `onLoadedMetadata` handler (line ~209); set `fps` and clear `detecting` when it resolves.
- Add a small **FPS control** near the transport row (~line 236): show the detected value (e.g. "30 fps · detected", or "detecting…") with a compact numeric input/override so the user can correct a wrong detection. Reuse the existing `ui/input.tsx` and `ui/button.tsx`.

### Frame-accurate stepping (with snapping to avoid drift)
- Add `stepFrame(dir: 1 | -1)`:
  ```
  const f = 1 / fps;
  const frameIndex = Math.round(current * fps);
  seekTo((frameIndex + dir) * f + f * 0.001); // epsilon lands inside the target frame
  ```
  This snaps to frame boundaries each press so repeated stepping doesn't accumulate error.
- Wire the ◀ / ▶ buttons (lines ~243 and the matching next-frame button) to `stepFrame(-1)` / `stepFrame(1)`. Update their `title` to "Previous frame (1/fps)".
- Keep using the existing `seekTo` helper.

### Optional ultra-fine nudge
- Since seeking accepts any millisecond, add small `±1 ms` (or `±10 ms`) ghost buttons next to the frame arrows for sub-frame precision. Low effort, satisfies "as granular as possible" below one frame. (Include unless the user prefers to keep the control bar minimal.)

## Part 2 — Vertical / arbitrary aspect-ratio support

### Player (`analyzer.tsx`, ~line 203–214)
- Capture intrinsic size in `onLoadedMetadata`: store `aspect = videoWidth / videoHeight` in state.
- Remove `aspect-video` from the `<video>`. Apply the real aspect ratio (e.g. `style={{ aspectRatio: aspect }}`) and `className="max-h-[70vh] w-full object-contain mx-auto"`, keeping the black wrapper so portrait video letterboxes cleanly and never overflows the viewport.

### Keyframe thumbnails (`src/app/components/keyframe-strip.tsx`)
- The `<img>` currently uses `aspect-video w-full object-cover`. Change to respect the source ratio without cropping: render the thumb in a fixed-size black tile using `object-contain` (e.g. keep `w-40`, set a consistent tile height, `object-contain bg-black`). Portrait frames then show fully, letterboxed.

### Diff frame cards + heatmap (`src/app/components/diff-panel.tsx`)
- `FrameCard` `<img>`: switch `aspect-video object-cover` → `object-contain` on a black tile so portrait frames aren't cropped.
- The heatmap `<img>` already uses `object-contain` — fine; it derives size from `imageData`, which is already correct.
- No change to `diffFrames` or `diffHeight()`; the diff buffer already follows the true aspect ratio.

## Critical files
- `src/app/components/analyzer.tsx` — FPS detection, fps state + control, frame-accurate stepping, player aspect ratio.
- `src/app/components/keyframe-strip.tsx` — thumbnail letterboxing.
- `src/app/components/diff-panel.tsx` — frame-card letterboxing.
- (Optional) `src/app/lib/video-utils.ts` — house `detectFps`/fps-snapping helper if kept out of the component.

## Verification
1. Open the running preview (do not start a new dev server).
2. **Landscape clip (known fps):** confirm the control shows the right rate (e.g. 24/30/60). Press ▶ frame: timecode should advance by exactly `1000/fps` ms each press (e.g. 60fps → ~16.7 ms; 24fps → ~41.7 ms). Step forward N times then back N times and confirm it returns to the same millisecond (no drift).
3. **Override:** type a different FPS and confirm the step size changes accordingly.
4. **Portrait clip (e.g. phone video):** confirm the player shows it upright and undistorted, capped at ~70vh, letterboxed on black. Capture frames and confirm thumbnails and diff frame cards show the full portrait frame (not cropped), and the difference heatmap still aligns.
5. **Square / unusual ratio:** quick sanity check that nothing overflows horizontally on mobile width.
