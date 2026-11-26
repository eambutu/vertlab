import { useRef, useState } from "react";
import { Send } from "lucide-react";
import { useAuth } from "../lib/auth";
import { sendDiagnostics } from "../lib/diagnostics";
import { supabase } from "../lib/supabase";
import { Button } from "./ui/button";

export function ErrorReport() {
  const auth = useAuth();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [reportId, setReportId] = useState<string>();
  const sending = useRef(false);

  async function send() {
    if (sending.current) return;
    sending.current = true;
    setStatus("sending");
    try {
      setReportId(await sendDiagnostics());
      setStatus("sent");
    } catch {
      setStatus("failed");
    } finally {
      sending.current = false;
    }
  }

  if (!supabase) return <p className="text-sm">Connect Supabase to send error reports.</p>;
  if (auth.status === "loading") return null;
  if (auth.status === "signed-out") return <p className="text-sm">Sign in to send an error report.</p>;

  return (
    <div className="flex min-w-0 flex-col items-start gap-2 text-left text-sm">
      {status === "sent" ? (
        <p role="status">
          Report sent. Share this ID when asking for help.
          <code className="mt-1 block select-all break-all">{reportId}</code>
        </p>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={status === "sending"}
          onClick={send}
          className="rounded-xl bg-white text-foreground"
        >
          <Send className="size-4" />
          {status === "sending" ? "Sending report…" : "Send error report"}
        </Button>
      )}
      {status === "failed" && (
        <p role="alert">Couldn't send the report. Your diagnostics are still in this browser. Try again.</p>
      )}
    </div>
  );
}
