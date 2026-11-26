import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

// Keep the SDK's existing key so previously signed-in devices stay signed in.
export const AUTH_STORAGE_KEY = SUPABASE_URL
  ? `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`
  : undefined;

/** Null when the app runs without a backend (everything stays in this browser). */
export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storageKey: AUTH_STORAGE_KEY } })
    : null;
