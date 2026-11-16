import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { HeroShell } from "../home";
import {
  AuthError,
  resendConfirmation,
  signIn,
  signUp,
  takeLinkError,
} from "../../lib/auth";

type Mode = "sign-in" | "sign-up";

const CARD =
  "w-full min-w-0 rounded-[1.75rem] border border-black/8 bg-white/80 p-5 shadow-[0_20px_50px_-28px_rgba(24,24,27,0.45)] backdrop-blur-sm";

function useResend(email: string) {
  const [sending, setSending] = useState(false);
  return {
    sending,
    resend: async () => {
      setSending(true);
      try {
        await resendConfirmation(email);
        toast.success("Confirmation email sent", { description: email });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't send the email");
      } finally {
        setSending(false);
      }
    },
  };
}

/** Shown after sign-up until the person opens the link in their email. */
function CheckEmail({ email, onBack }: { email: string; onBack: () => void }) {
  const { sending, resend } = useResend(email);
  return (
    <div className={CARD}>
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-zinc-950 text-white">
          <MailCheck className="size-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Check your email</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            We sent a link to <span className="font-medium text-foreground">{email}</span>.
            Open it on this device to finish creating your account.
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="h-11 rounded-xl border-black/10 bg-white"
          onClick={onBack}
        >
          Back to sign in
        </Button>
        <Button className="h-11 rounded-xl" disabled={sending} onClick={resend}>
          {sending && <Loader2 className="size-4 animate-spin" />}
          Resend email
        </Button>
      </div>
    </div>
  );
}

export function SignInPage() {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthError | null>(() => {
    const linkError = takeLinkError();
    return linkError ? new AuthError(linkError, "unconfirmed") : null;
  });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { sending, resend } = useResend(email.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "sign-in") {
        await signIn(email.trim(), password);
        // The auth listener swaps this page for the library.
      } else {
        await signUp(email.trim(), password);
        setSentTo(email.trim());
        setPassword("");
      }
    } catch (err) {
      setError(
        err instanceof AuthError ? err : new AuthError("Something went wrong. Try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <HeroShell>
        <CheckEmail
          email={sentTo}
          onBack={() => {
            setSentTo(null);
            setMode("sign-in");
          }}
        />
      </HeroShell>
    );
  }

  return (
    <HeroShell>
      <form className={CARD} onSubmit={submit} noValidate>
        <ToggleGroup
          type="single"
          aria-label="Sign in or create an account"
          value={mode}
          onValueChange={(v) => {
            if (!v) return;
            setMode(v as Mode);
            setError(null);
          }}
          className="grid w-full grid-cols-2 gap-1 rounded-xl bg-black/[0.07] p-1"
        >
          {(
            [
              ["sign-in", "Sign in"],
              ["sign-up", "Create account"],
            ] as const
          ).map(([value, label]) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="h-10 rounded-[9px]! text-[13px] font-semibold text-zinc-600 hover:bg-transparent data-[state=on]:bg-white data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="mt-5 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-xl border-black/15 bg-white shadow-xs focus-visible:border-zinc-400"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={mode === "sign-up" ? "password-hint" : undefined}
                className="h-11 rounded-xl border-black/15 bg-white pr-11 shadow-xs focus-visible:border-zinc-400"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-1 top-1/2 size-9 -translate-y-1/2 rounded-lg text-zinc-500"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
            {mode === "sign-up" && (
              <p id="password-hint" className="text-xs text-muted-foreground">
                At least 8 characters.
              </p>
            )}
          </div>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-red-800">
            {error.message}
            {error.code === "unconfirmed" && (
              <button
                type="button"
                onClick={resend}
                disabled={sending || !email.trim()}
                className="mt-1 block font-medium underline underline-offset-4 disabled:opacity-50"
              >
                {sending ? "Sending…" : "Resend confirmation email"}
              </button>
            )}
          </div>
        )}

        <Button
          type="submit"
          className="mt-5 h-11 w-full rounded-xl"
          disabled={busy || !email.trim() || !password}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </Button>
      </form>
    </HeroShell>
  );
}
