// Labs: runs the finder on every hand-tagged clip in the library and reports
// how often the true frame lands inside the 4-frame window.
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  BackHeader,
  ClipThumb,
  ListCard,
  Page,
  SectionLabel,
  modeLabel,
} from "../../components/library/parts";
import { whenRecorded } from "../../lib/format";
import { store, useClips } from "../../lib/store";
import type { Clip } from "../../lib/store";
import { findKeyframes } from "./finder";
import { SUGGEST_MODES, useSuggestKeyframes } from "./flag";

const EXPECTED: Record<string, number> = {
  "approach-jump": 4,
  "depth-jump": 3,
  "ten-five-rsi": 3,
};

interface EventResult {
  group: string;
  trueFrame: number;
  suggestedFrame: number | null;
  inWindow: boolean;
}

interface ClipResult {
  clip: Clip;
  status: "pending" | "running" | "done" | "failed";
  reason?: string;
  events: EventResult[];
}

/** "Jump 3 takeoff" → "Takeoff", so 10-5 events pool by kind. */
function groupOf(mode: string, label: string) {
  const g = label.replace(/^Jump \d+ /, "");
  return `${modeLabel({ mode })} · ${g.charAt(0).toUpperCase()}${g.slice(1)}`;
}

function pct(n: number, d: number) {
  return d ? `${Math.round((100 * n) / d)}%` : "–";
}

function median(values: number[]) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function evaluate(clip: Clip, signal: AbortSignal): Promise<Omit<ClipResult, "clip">> {
  const fps = clip.fps ?? 30;
  const url = await store.getVideoUrl(clip.id);
  if (!url) return { status: "failed", reason: "Video not available", events: [] };
  try {
    const result = await findKeyframes({ url, mode: clip.mode, fps, signal, withImages: false });
    if (!result.ok) return { status: "failed", reason: result.reason, events: [] };
    const truth = [...clip.keyframes].sort((a, b) => a - b);
    const n = clip.mode === "ten-five-rsi" ? truth.length : EXPECTED[clip.mode];
    const events: EventResult[] = [];
    for (let i = 0; i < n && i < truth.length; i++) {
      const ev = result.events[i];
      const trueFrame = Math.round(truth[i] * fps);
      const label = ev?.label ?? (i === 0 ? "Initial landing" : `Event ${i + 1}`);
      if (!ev?.found) {
        events.push({ group: groupOf(clip.mode, label), trueFrame, suggestedFrame: null, inWindow: false });
        continue;
      }
      events.push({
        group: groupOf(clip.mode, ev.label),
        trueFrame,
        suggestedFrame: ev.candidates[ev.suggested].frame,
        inWindow: ev.candidates.some((c) => c.frame === trueFrame),
      });
    }
    return { status: "done", events };
  } finally {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}

export default function AccuracyPage() {
  const on = useSuggestKeyframes();
  const clips = useClips();
  const [results, setResults] = useState<ClipResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const eligible = (clips ?? []).filter(
    (c) =>
      SUGGEST_MODES.includes(c.mode) &&
      c.keyframes.length >= EXPECTED[c.mode] &&
      c.videoStatus !== "failed",
  );

  async function run() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    const rows: ClipResult[] = eligible.map((clip) => ({ clip, status: "pending", events: [] }));
    setResults([...rows]);
    for (let i = 0; i < rows.length; i++) {
      if (controller.signal.aborted) break;
      rows[i] = { ...rows[i], status: "running" };
      setResults([...rows]);
      try {
        rows[i] = { clip: rows[i].clip, ...(await evaluate(rows[i].clip, controller.signal)) };
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") break;
        rows[i] = { ...rows[i], status: "failed", reason: "Error while reading", events: [] };
      }
      setResults([...rows]);
    }
    setRunning(false);
  }

  const all = (results ?? []).flatMap((r) => r.events);
  // In the order events happen (first seen), not alphabetical.
  const groups = [...new Set(all.map((e) => e.group))];

  return (
    <Page>
      <BackHeader to="/settings" label="Back to settings" title="Keyframe accuracy" />
      <p className="px-1 pb-4 text-[13px] text-muted-foreground">
        Runs "Find keyframes" on your hand-tagged clips and checks whether the
        frame you chose is one of the 4 it suggests.
      </p>

      {!on ? (
        <p className="px-1 text-sm">Turn on Suggest keyframes in Settings → Labs first.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Button
              className="h-11 flex-1 rounded-xl"
              disabled={running || eligible.length === 0}
              onClick={() => void run()}
            >
              {running && <Loader2 className="size-4 animate-spin" />}
              {running ? "Testing…" : `Test ${eligible.length} clip${eligible.length === 1 ? "" : "s"}`}
            </Button>
            {running && (
              <Button variant="outline" className="h-11 rounded-xl bg-white" onClick={() => abort.current?.abort()}>
                Stop
              </Button>
            )}
          </div>
          {clips && eligible.length === 0 && (
            <p className="px-1 text-sm text-muted-foreground">
              No clips to test yet. Tag an Approach jump (4 keyframes), Depth jump
              (3) or 10-5 RSI clip by hand first.
            </p>
          )}

          {groups.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <SectionLabel>By event</SectionLabel>
              <div className="overflow-x-auto rounded-2xl border border-black/8 bg-white">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b border-black/[0.07]">
                      <th className="px-3 py-2 font-medium">Event</th>
                      <th className="px-2 py-2 text-right font-medium">In window</th>
                      <th className="px-2 py-2 text-right font-medium">Exact</th>
                      <th className="px-2 py-2 text-right font-medium">±1</th>
                      <th className="px-3 py-2 text-right font-medium">Median off</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {groups.map((g) => {
                      const evs = all.filter((e) => e.group === g);
                      const found = evs.filter((e) => e.suggestedFrame != null);
                      const errs = found.map((e) => Math.abs(e.suggestedFrame! - e.trueFrame));
                      const hit = evs.filter((e) => e.inWindow).length;
                      const med = median(errs);
                      return (
                        <tr key={g} className="border-b border-black/[0.07] last:border-0">
                          <td className="px-3 py-2 font-sans">
                            {g} <span className="text-xs text-muted-foreground">({evs.length})</span>
                          </td>
                          <td
                            className={`px-2 py-2 text-right ${hit / evs.length >= 0.9 ? "text-green-700" : ""}`}
                          >
                            {pct(hit, evs.length)}
                          </td>
                          <td className="px-2 py-2 text-right">{pct(errs.filter((e) => e === 0).length, evs.length)}</td>
                          <td className="px-2 py-2 text-right">{pct(errs.filter((e) => e <= 1).length, evs.length)}</td>
                          <td className="px-3 py-2 text-right">
                            {isNaN(med) ? "–" : `${med} fr`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="px-1 text-xs text-muted-foreground">
                Goal: 90% in window for contact, takeoff and landing. "fr" = frames.
              </p>
            </section>
          )}

          {results && results.length > 0 && (
            <section className="flex flex-col gap-1.5">
              <SectionLabel>Clips</SectionLabel>
              <ListCard>
                {results.map((r) => {
                  const misses = r.events.filter((e) => !e.inWindow);
                  return (
                    <div key={r.clip.id} className="flex items-start gap-3 py-2.5 pl-3 pr-3">
                      <ClipThumb clip={r.clip} />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="font-medium">
                          {modeLabel(r.clip)}
                          <span className="font-normal text-muted-foreground">
                            {" "}· {whenRecorded(r.clip.createdAt)}
                          </span>
                        </p>
                        {r.status === "pending" && <p className="text-muted-foreground">Waiting</p>}
                        {r.status === "running" && (
                          <p className="flex items-center gap-1.5 text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" /> Testing
                          </p>
                        )}
                        {r.status === "failed" && <p className="text-red-700">{r.reason}</p>}
                        {r.status === "done" &&
                          (misses.length === 0 ? (
                            <p className="text-green-700">All {r.events.length} in window</p>
                          ) : (
                            <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                              {misses.map((e, i) => (
                                <li key={i}>
                                  {e.group.split(" · ")[1]}:{" "}
                                  {e.suggestedFrame == null
                                    ? "not found"
                                    : `${Math.abs(e.suggestedFrame - e.trueFrame)} frames ${
                                        e.suggestedFrame > e.trueFrame ? "late" : "early"
                                      }`}
                                </li>
                              ))}
                            </ul>
                          ))}
                      </div>
                    </div>
                  );
                })}
              </ListCard>
            </section>
          )}
        </div>
      )}
    </Page>
  );
}
