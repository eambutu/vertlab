import { parseMode } from "../../lib/metrics";
import { MODES } from "./index";

/**
 * A mode's results section (heading + panel). Shared by the analyzer and the
 * share viewer so both show the same numbers the same way.
 */
export function ModeResults({
  mode,
  times,
  fps,
}: {
  /** Full mode string, e.g. "depth-jump:3". */
  mode: string;
  times: number[];
  fps: number;
}) {
  const parsed = parseMode(mode);
  const m = MODES.find((x) => x.id === parsed.id);
  if (!m) return null;
  const { Panel } = m;
  return (
    <section className="space-y-3">
      <h2>{m.label}</h2>
      <Panel keyframes={times.map((time) => ({ time }))} fps={fps} reps={parsed.reps} />
    </section>
  );
}
