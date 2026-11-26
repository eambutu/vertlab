import { Fragment, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { SignInPage } from "./sign-in-page";

/** Private screens: shows sign-in in place, then the page you were after. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f3ef] text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (auth.status === "signed-out") return <SignInPage />;
  return <Fragment key={auth.userId}>{children}</Fragment>;
}
