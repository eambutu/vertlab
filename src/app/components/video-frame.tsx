import { useRef, type ReactNode, type Ref } from "react";
import { ErrorReport } from "./error-report";
import type { useVideoDiagnostics } from "./use-video-diagnostics";

interface VideoFrameProps {
  videoRef: Ref<HTMLVideoElement>;
  src: string;
  aspect: number;
  poster?: string;
  preload?: "metadata";
  diagnostics: ReturnType<typeof useVideoDiagnostics>;
  onMetadata: (video: HTMLVideoElement) => void;
  onFirstFrame?: (video: HTMLVideoElement) => void;
  onError?: () => void;
  onTogglePlay: () => void;
  onPlayingChange: (playing: boolean) => void;
  children?: ReactNode;
}

export function VideoFrame({
  videoRef, src, aspect, poster, preload, diagnostics, onMetadata, onFirstFrame, onError,
  onTogglePlay, onPlayingChange, children,
}: VideoFrameProps) {
  const firstFrameSource = useRef<string>();
  function frameReady(video: HTMLVideoElement) {
    diagnostics.onFrameReady(video);
    if (firstFrameSource.current !== src) {
      firstFrameSource.current = src;
      onFirstFrame?.(video);
    }
  }
  return (
    <div className="relative flex justify-center overflow-hidden rounded-2xl border border-border bg-black">
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        preload={preload}
        crossOrigin="anonymous"
        playsInline
        style={{ aspectRatio: aspect }}
        className="max-h-[70vh] w-full bg-black object-contain"
        onClick={onTogglePlay}
        onLoadedMetadata={({ currentTarget }) => {
          diagnostics.onMetadata(currentTarget);
          onMetadata(currentTarget);
        }}
        onLoadedData={({ currentTarget }) => frameReady(currentTarget)}
        onCanPlay={({ currentTarget }) => frameReady(currentTarget)}
        onStalled={({ currentTarget }) => diagnostics.onStalled(currentTarget)}
        onError={({ currentTarget }) => {
          diagnostics.onError(currentTarget);
          onError?.();
        }}
        onPlay={() => onPlayingChange(true)}
        onPause={() => onPlayingChange(false)}
        onEnded={() => onPlayingChange(false)}
      />
      {diagnostics.message ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto p-4 text-center">
          <p role="alert" className="text-sm text-white">{diagnostics.message}</p>
          <ErrorReport />
        </div>
      ) : children}
    </div>
  );
}
