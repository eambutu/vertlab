// Public lookup for share links: GET /functions/v1/share-view?token=…
// Runs with the service role, so it must only ever return what a link
// exposes: the shared clips' numbers and short-lived video URLs.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SIGNED_URL_SECONDS = 60 * 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      // Short, so a stopped link breaks quickly even behind caches.
      "Cache-Control": "private, max-age=60",
    },
  });
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// Locally the function reaches storage at an internal hostname; signed URLs
// have to point at the address browsers use.
const publicUrl = Deno.env.get("PUBLIC_SUPABASE_URL") ?? supabaseUrl;
const toPublic = (url: string) =>
  url.startsWith(supabaseUrl) ? publicUrl + url.slice(supabaseUrl.length) : url;

const CLIP_FIELDS =
  "id, created_at, day, mode, keyframes, fps, duration, width, height, summary, poster, video_path";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const params = new URL(req.url).searchParams;
  const match = /^([0-9A-Za-z]{6,32})(?:\.([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}))?$/.exec(params.get("token") ?? "");
  const day = params.get("day");
  if (!match || (day !== null && (!match[2] || !/^\d{4}-\d{2}-\d{2}$/.test(day)))) return json({ error: "not_found" }, 404);

  const { data: root, error: rootError } = await admin
    .from("shares")
    .select("id, user_id, kind, day")
    .eq("token", match[1])
    .is("revoked_at", null)
    .maybeSingle();
  if (rootError) return json({ error: "lookup_failed" }, 500);
  if (!root) return json({ error: "not_found" }, 404);

  let share = root;
  let sharedDays: string[] | undefined;
  if (match[2]) {
    // The owner includes the random share UUID only when copying a library link.
    if (root.kind !== "day" || root.id !== match[2]) return json({ error: "not_found" }, 404);
    const sessions: { id: string; day: string }[] = [];
    for (let offset = 0; ; offset += 200) {
      const { data, error } = await admin.from("shares")
        .select("id, day, share_clips!inner(clips!inner(id))")
        .eq("user_id", root.user_id).eq("kind", "day").is("revoked_at", null)
        .eq("share_clips.clips.user_id", root.user_id)
        .not("share_clips.clips.video_path", "is", null)
        .limit(1, { referencedTable: "share_clips" })
        .order("day", { ascending: false }).range(offset, offset + 199);
      if (error) return json({ error: "lookup_failed" }, 500);
      sessions.push(...data);
      if (data.length < 200) break;
    }
    const selected = sessions.find(s => s.day === (day ?? root.day));
    if (!selected || !sessions.some(s => s.id === root.id)) return json({ error: "not_found" }, 404);
    sharedDays = sessions.map(s => s.day);
    share = { ...root, id: selected.id, day: selected.day };
  }

  const { data: rows, error } = await admin
    .from("share_clips")
    .select(`position, clips!inner (${CLIP_FIELDS})`)
    .eq("share_id", share.id)
    .eq("clips.user_id", root.user_id)
    .order("position");
  if (error) return json({ error: "lookup_failed" }, 500);

  // deno-lint-ignore no-explicit-any
  const clips = (rows ?? []).map((r: any) => r.clips).filter((c: any) => c?.video_path);
  if (clips.length === 0) return json({ error: "not_found" }, 404);

  const { data: signed, error: signError } = await admin.storage
    .from("clips")
    .createSignedUrls(clips.map((c: { video_path: string }) => c.video_path), SIGNED_URL_SECONDS);
  if (signError || !signed) return json({ error: "lookup_failed" }, 500);

  // A single jump can point to a live day link that includes it.
  let partOf: { token: string; day: string; count: number } | undefined;
  if (share.kind === "clip") {
    const { data: days } = await admin
      .from("shares")
      .select("token, day, created_at, share_clips!inner(clip_id), all:share_clips(count)")
      .eq("user_id", share.user_id)
      .eq("kind", "day")
      .is("revoked_at", null)
      .eq("share_clips.clip_id", clips[0].id)
      .order("created_at", { ascending: false })
      .limit(1);
    const d = days?.[0];
    // deno-lint-ignore no-explicit-any
    if (d) partOf = { token: d.token, day: d.day, count: (d as any).all?.[0]?.count ?? 0 };
  }

  return json({
    kind: share.kind,
    day: share.day ?? undefined,
    partOf,
    sharedDays,
    // deno-lint-ignore no-explicit-any
    clips: clips.map((c: any, i: number) => ({
      id: c.id,
      createdAt: Date.parse(c.created_at),
      day: c.day,
      mode: c.mode,
      keyframes: c.keyframes,
      fps: c.fps ?? undefined,
      duration: c.duration ?? undefined,
      width: c.width ?? undefined,
      height: c.height ?? undefined,
      summary: c.summary,
      poster: c.poster ?? undefined,
      videoUrl: toPublic(signed[i].signedUrl),
    })),
  });
});
