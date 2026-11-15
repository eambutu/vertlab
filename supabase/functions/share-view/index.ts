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

  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9A-Za-z]{6,32}$/.test(token)) return json({ error: "not_found" }, 404);

  const { data: share } = await admin
    .from("shares")
    .select("id, user_id, kind, day")
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle();
  if (!share) return json({ error: "not_found" }, 404);

  const { data: rows, error } = await admin
    .from("share_clips")
    .select(`position, clips (${CLIP_FIELDS})`)
    .eq("share_id", share.id)
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
