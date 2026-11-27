import { useEffect, useRef, useState } from "react";
import { Check, Plus, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { ANALYSIS_OPTIONS } from "../../lib/exercise-types";
import { composeMode, parseMode, summarize, CUSTOM_LABEL_MAX } from "../../lib/metrics";
import { store, type Clip } from "../../lib/store";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "../ui/drawer";

export function ExercisePicker({ clip, clips, close }: { clip: Clip; clips: Clip[]; close: () => void }) {
  const [saved, setSaved] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const parsed = parseMode(clip.mode);
  useEffect(() => {
    let active = true;
    store.recentCustomModes().then(modes => { if (active) setSaved(modes); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const recent = [...new Set([clip.mode, ...clips.map(c => c.mode), ...saved]
    .filter(mode => mode.startsWith("custom:")))].slice(0, 12);

  async function choose(mode: string) {
    if (busy.current) return;
    if (mode === clip.mode) { close(); return; }
    busy.current = true;
    setSaving(true);
    try {
      const current = await store.getClip(clip.id);
      if (!current) throw new Error("Missing clip");
      await store.updateClip(clip.id, { mode, summary: summarize(mode, current.keyframes) });
      close();
      toast.success("Exercise updated");
    } catch {
      toast.error("Couldn’t update this exercise. Try again.");
      busy.current = false;
      setSaving(false);
    }
  }

  return <Drawer open onOpenChange={open => { if (!open && !busy.current) close(); }}>
    <DrawerContent className="mx-auto max-w-lg rounded-t-3xl bg-white px-5 pb-6">
      <header className="pb-4 pt-4">
        <DrawerTitle className="text-xl font-semibold tracking-tight">Change exercise</DrawerTitle>
        <DrawerDescription className="truncate text-sm">{clip.title}</DrawerDescription>
      </header>
      <div className="space-y-4 overflow-y-auto pb-2" data-vaul-no-drag>
        <section aria-label="Custom exercises">
          <h3 className="mb-2 text-xs font-semibold text-zinc-600">Custom exercises</h3>
          <div className="flex flex-wrap gap-2">
            {recent.map(mode => <button type="button" key={mode} disabled={saving} aria-pressed={mode === clip.mode}
              onClick={() => choose(mode)}
              className="inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3.5 text-sm font-medium aria-pressed:border-zinc-900 aria-pressed:bg-zinc-900 aria-pressed:text-white">
              {mode === clip.mode && <Check className="size-4 shrink-0" />}<span className="truncate">{parseMode(mode).label}</span>
            </button>)}
            <button type="button" disabled={saving} onClick={() => setEditing(true)}
              className="inline-flex min-h-10 items-center gap-1 rounded-full border border-dashed border-zinc-400 px-3 text-sm"><Plus className="size-4" /> New label</button>
          </div>
          {editing && <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); if (name.trim()) void choose(composeMode("custom", {label:name})); }}>
            <input autoFocus aria-label="Exercise name" placeholder="Exercise name" maxLength={CUSTOM_LABEL_MAX} value={name} onChange={e => setName(e.target.value)} className="min-w-0 flex-1 rounded-xl border px-3 py-2" />
            <button disabled={!name.trim() || saving} className="rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-40">Apply</button>
          </form>}
        </section>
        <section aria-label="Analysis types">
          <h3 className="mb-2 text-xs font-semibold text-zinc-600">Analysis type</h3>
          <div className="divide-y rounded-2xl border border-zinc-200">
            {ANALYSIS_OPTIONS.filter(o => o.id !== "custom").map(o => <button type="button" key={o.id}
              disabled={saving} aria-pressed={parsed.id === o.id} onClick={() => choose(parsed.id === o.id ? clip.mode : o.id)}
              className="flex min-h-11 w-full items-center justify-between px-4 text-left text-sm font-medium hover:bg-zinc-50">
              {o.label}{parsed.id === o.id ? <Check className="size-4" /> : <ArrowUpRight aria-hidden className="size-3.5 text-zinc-400" />}
            </button>)}
          </div>
        </section>
      </div>
    </DrawerContent>
  </Drawer>;
}
