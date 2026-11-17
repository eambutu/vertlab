# Scope: suggested keyframes you confirm by flipping between 4 frames

> **Status: built behind Settings → Labs → "Suggest keyframes"** (off by
> default, per device). All code lives in `src/app/features/keyframe-suggest/`.
> Removing it means deleting that folder plus four small hooks:
> - the Labs section in `settings-page.tsx`
> - the lazy `SuggestKeyframes` block and the `captureHook` check in
>   `analyzer.tsx` (the `framesAt` / `applyKeyframeTimes` helpers there are
>   harmless to keep)
> - the `/labs/keyframe-accuracy` route in `App.tsx`
> - the `@mediapipe/tasks-vision` dependency
>
> **Changed from the scope below:**
> - The `clips.tagging` column is **not** added yet. A database column is
>   harder to remove than a flag, so add it once the feature earns its keep.
> - The accuracy test page lives at `/labs/keyframe-accuracy` (linked from
>   Settings when Labs is on), not `/dev/…`.
> - Phases 1–3 are built together; the optional VLM tie-breaker isn't.
> - The fine search pads by `2 + stride` frames, so 120/240 fps clips get a
>   wider window around the coarse guess.

## The idea

Instead of tagging every keyframe automatically, VertLab finds each **event**
(penultimate step, ground contact, takeoff, landing) and proposes a
**4-frame window** where it thinks the event happens. You flip between those
4 frames and tap the one that's right. If none of them is right, you drop
into the normal scrubber, already positioned there.

The machine only has to get *near* the right frame; you supply the last frame
of precision. That turns "is the detector frame-perfect?" into a much easier
question: "is the right frame inside the window?"

## Experience

### Starting it

- In the analyzer, under **Capture this frame**, add **Find keyframes**
  (shown for Approach jump and Depth jump in v1).
- Tapping it analyzes the clip in the browser, with progress
  ("Finding the athlete… 40%"). This takes a few seconds for a 2–3 s clip
  and never uploads anything.
- If there are already keyframes, ask first: "Replace your 4 keyframes?"

### Confirming each event (one screen per event)

A full-height sheet on phones, a dialog on desktop, built from the existing
`Drawer`/`Dialog` components:

```
 ‹  Takeoff                          2 of 4
 ┌─────────────────────────────────────┐
 │                                     │
 │       large frame (selected)        │   tap to toggle a 2× crop
 │                                     │   around the foot
 └─────────────────────────────────────┘
   00:01.153   +4.2 ms from previous

  [ f1 ] [ f2 ] [▣f3 ] [ f4 ]            4 thumbnails, best guess preselected

  [        Use this frame        ]       primary
     None of these · Skip                secondary links
```

- **Flipping:** swipe left/right on the big frame, tap a thumbnail, or press
  ←/→ (and 1–4) on a keyboard. Adjacent frames look nearly identical, so the
  big frame swaps instantly with no animation, which makes small differences
  pop.
- **Foot zoom:** one tap shows a 2× crop around the detected foot. That's
  where the difference between candidate frames actually is.
- **Use this frame** saves it and moves on to the next event.
- **None of these** closes the sheet and leaves the scrubber parked at the
  middle of the window, with that event's label waiting for the next capture.
  When you capture, the sheet resumes at the following event.
- **Skip** leaves the event untagged and moves on.
- **‹ Back** returns to the previous event, keeping what you chose.
- Order is enforced: an event's candidates always come after the frame
  you picked for the previous one. Picking a frame re-ranks the later
  windows if needed.

At the end, the keyframes land in the strip exactly as hand-captured ones do,
so the result panels, autosave, sharing and press-and-hold remove all work
unchanged.

### When detection fails

No person found, feet out of view, or a very low-confidence signal:
"Couldn't find the feet clearly in this video. Capture keyframes by hand, or
try a side-on clip with the feet in view." The uploader gets a matching
one-line filming tip.

## How candidates are found

Runs entirely in the browser.

1. **Read every frame once.** Step through the video at its native frame
   rate (the fps the analyzer already detects) and grab a downscaled frame
   for each.
   - v1: seek-based stepping, which is simple and exact but takes ~20–40 ms
     per frame. That's about 15–25 s for a 2–3 s clip at 240 fps.
   - If that's too slow: decode with WebCodecs, which is much faster but
     needs an MP4 demuxer (e.g. `mp4box.js`), and add it only if the timings
     demand it.
2. **Find the athlete and feet.** Run MediaPipe Pose Landmarker (lite model,
   ~3 MB, `@mediapipe/tasks-vision`) on each frame to get heel, ankle and toe
   positions for both feet.
3. **Coarse events from the foot paths.** Smooth the foot heights and
   velocities, and find the ground level (the lowest stable foot height).
   Then:
   - **Contact:** a foot arrives at ground level and stops moving down.
   - **Takeoff:** the last frame before both feet rise off the ground.
   - **Landing:** the first frame a foot is back at ground level.
   - **Penultimate step** (approach only): the foot contact before the
     final one.
4. **Fine ranking in a small window.** Around each coarse event (±6
   frames), crop a box around the foot and measure frame-to-frame pixel
   change, reusing `diffFrames` in `lib/video-utils.ts`. Contact shows as
   motion collapsing; takeoff as motion starting. Score each frame.
5. **Pick the 4.** Take the **4 consecutive frames** centred on the
   highest-scoring frame, with that frame preselected. If the score is
   spread out (low confidence), say so in the sheet ("Less sure about this
   one") rather than widening the window.

Why 4 consecutive frames rather than the 4 best-scoring anywhere? Because the
real error is "off by a frame or two", and a contiguous window makes flipping
read like stepping through time.

**Frame rate matters.** At 240 fps, 4 frames cover about 17 ms; at 30 fps
they cover 133 ms. Low-fps clips will hit the window more easily but the
answer is coarser anyway.

## Measuring it before shipping

The success metric is **hit rate**: how often the true frame is inside the
4-frame window, per event type.

- **Test set:** 10–20 clips you've already tagged by hand (they're in your
  library), ideally a mix of phones, angles and lighting.
- **A hidden dev page** (`/dev/keyframe-eval`, signed-in only) runs the
  candidate finder on every hand-tagged clip in the library. It reports, per
  event type, the hit rate, the median distance from the true frame, and
  which clips missed, with a thumbnail of each miss.
- **Bar to ship:** ≥ 90% hit rate on contact, takeoff and landing. Below
  that, tune step 4 first, then consider the VLM tie-breaker below.

## What gets stored

Keyframes stay a list of times, as today. For each clip, also save how each
keyframe was made, so we can measure accuracy in real use and later train on
it:

```jsonc
// clips.tagging (new jsonb column, null for hand-tagged clips)
{
  "version": 1,
  "events": [
    {
      "event": "takeoff",
      "candidates": [1.1488, 1.1529, 1.1571, 1.1613],
      "suggested": 2,      // index preselected by the finder
      "chosen": 2,         // index you picked; null = "None of these"/skipped
      "final": 1.1571      // the keyframe time that was saved
    }
  ]
}
```

That needs one migration (`alter table clips add column tagging jsonb`), the
field on `Clip`/`ClipPatch`, and both stores passing it through. Share links
don't expose it.

## Phases

1. **Finder + eval page.** Frame stepping, pose, coarse events, fine
   ranking, and the dev eval page. Approach jump first, then depth jump.
   Ships nothing user-facing; ends with hit-rate numbers on your clips.
   *About 2–3 days.*
2. **Confirm flow.** The Find keyframes button, the per-event sheet, None of
   these/Skip/Back, foot zoom, keyboard and swipe controls, and saving
   `tagging`. *About 2 days.*
3. **10-5 RSI.** About 21 events per clip, so one-by-one is too slow. Instead:
   accept the suggested frame for every event at once, then review only the
   low-confidence ones in the same sheet. *About 1–2 days.*
4. **Optional VLM tie-breaker.** Only for events that miss the bar in
   phase 1. Send Claude Haiku 5.5 a strip of zoomed foot crops plus your
   written description, through a Supabase edge function. Cost is well under
   a cent per clip. *About 1 day.*

## Open questions for you

1. **Your definitions.** For each event, what exactly counts? For example,
   is ground contact "the first frame any part of the shoe touches" or "the
   first frame the foot stops moving"? These become the rules and the eval's
   ground truth.
2. **Clips for testing.** Which 10–20 tagged clips should form the test set?
   Are they mostly side-on?
3. **Multiple people.** Do clips ever have someone else in frame? v1 assumes
   one athlete (the largest person in view).
4. **Typical frame rate.** Mostly 240 fps slow-mo, or 30/60 fps?
5. **Phone speed.** Is ~15–25 s of analysis on a phone acceptable for v1, or
   should WebCodecs decoding be in from the start?
