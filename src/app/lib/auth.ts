import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; email?: string };

// Without a backend there are no accounts; the app behaves as signed in.
let state: AuthState = supabase ? { status: "loading" } : { status: "signed-in" };
const listeners = new Set<() => void>();

function fromSession(session: Session | null): AuthState {
  // Anonymous sessions came from an earlier build; they need a real account now.
  if (session?.user.is_anonymous) {
    supabase?.auth.signOut();
    return { status: "signed-out" };
  }
  return session
    ? { status: "signed-in", email: session.user.email ?? undefined }
    : { status: "signed-out" };
}

function set(next: AuthState) {
  if (
    next.status === state.status &&
    (next.status !== "signed-in" ||
      next.email === (state as { email?: string }).email)
  )
    return;
  state = next;
  listeners.forEach((l) => l());
}

// A confirmation link that failed (expired, already used) comes back with the
// reason in the URL hash. Surface it on the sign-in page and clean the URL.
export function takeLinkError(): string | null {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const description = hash.get("error_description");
  if (!description) return null;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return hash.get("error_code") === "otp_expired"
    ? "That confirmation link has expired or was already used. Sign in, or resend it below."
    : description.replace(/\+/g, " ");
}

if (supabase) {
  supabase.auth.getSession().then(({ data }) => set(fromSession(data.session)));
  supabase.auth.onAuthStateChange((_event, session) => set(fromSession(session)));
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Turns Supabase auth errors into copy for the sign-in page. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials"))
    return "That email and password don't match an account.";
  if (m.includes("email not confirmed"))
    return "Confirm your email first. Check your inbox for the link.";
  if (m.includes("already registered"))
    return "There's already an account with that email. Sign in instead.";
  if (m.includes("password should be at least"))
    return "Use a password with at least 8 characters.";
  if (m.includes("error sending"))
    return "We couldn't send the confirmation email. Try again in a little while.";
  if (m.includes("rate limit"))
    return "Too many emails sent recently. Try again in a little while.";
  if (m.includes("invalid") && m.includes("email"))
    return "That doesn't look like a valid email address.";
  return message;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: "unconfirmed" | "other" = "other",
  ) {
    super(message);
  }
}

function client() {
  if (!supabase) throw new AuthError("Accounts aren't set up for this app.");
  return supabase;
}

export async function signIn(email: string, password: string) {
  const { error } = await client().auth.signInWithPassword({ email, password });
  if (error)
    throw new AuthError(
      friendly(error.message),
      error.message.toLowerCase().includes("not confirmed") ? "unconfirmed" : "other",
    );
}

/** Creates the account and sends the confirmation email. */
export async function signUp(email: string, password: string) {
  const { data, error } = await client().auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw new AuthError(friendly(error.message));
  // Supabase hides whether an email is taken: an existing, confirmed address
  // comes back with no identities and no email is sent.
  if (data.user && data.user.identities?.length === 0)
    throw new AuthError(friendly("already registered"));
}

export async function resendConfirmation(email: string) {
  const { error } = await client().auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw new AuthError(friendly(error.message));
}

export async function signOut() {
  await client().auth.signOut();
}
