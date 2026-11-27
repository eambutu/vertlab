import { Component, type ReactNode } from "react";
import { logDiagnostic } from "../lib/diagnostics";
import { ErrorReport } from "./error-report";

export class ScreenErrorBoundary extends Component<{ children: ReactNode }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    const [, section, id] = location.pathname.split("/");
    const page = !section ? "library" : ["j", "d"].includes(section) ? "shared" : section;
    // Keep just the compiled file and position. Messages and URLs can contain private data.
    const frame = error?.stack?.match(/\/assets\/([\w-]+\.js):(\d+):(\d+)/);
    logDiagnostic("app", "screen render failed", {
      page, clipId: page === "clip" ? id : undefined, name: error?.name,
      bundle: frame?.[1], line: Number(frame?.[2]), column: Number(frame?.[3]),
    }, "error");
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-xl font-semibold">This screen couldn’t open</h1>
        <div className="flex items-center gap-4">
          <button className="rounded-xl bg-zinc-900 px-4 py-2 text-white" onClick={() => location.reload()}>
            Reload
          </button>
          <a className="underline" href="/">Back to library</a>
        </div>
        <ErrorReport />
      </main>
    );
  }
}
