import { useRef, useState } from "react";
import { Camera, Film, Upload } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "./ui/utils";

interface UploaderProps {
  onFile: (file: File) => void;
}

export function Uploader({ onFile }: UploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const dragCount = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("video/")) {
      setError("Use a video file — MP4, MOV, or WebM.");
      return;
    }
    setError(null);
    onFile(file);
  }

  return (
    <div className="w-full min-w-0">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragCount.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCount.current -= 1;
          if (dragCount.current <= 0) {
            dragCount.current = 0;
            setDragging(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragCount.current = 0;
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "box-border min-w-0 w-full max-w-full rounded-[1.75rem] border bg-white/80 p-3 shadow-[0_20px_50px_-28px_rgba(24,24,27,0.45)] backdrop-blur-sm transition-colors",
          dragging ? "border-zinc-900 bg-white" : "border-black/8",
        )}
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex w-full min-w-0 flex-col items-center justify-center gap-3 whitespace-normal rounded-[1.25rem] border-2 border-dashed px-5 py-8 text-center transition-colors",
            dragging
              ? "border-zinc-900 bg-zinc-950/[0.03]"
              : "border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50/80",
          )}
        >
          <div className="flex size-12 items-center justify-center rounded-full bg-zinc-950 text-white">
            <Film className="size-5" />
          </div>
          <div>
            <p className="text-[15px] font-medium">Drop a jump video</p>
            <p className="mt-1 text-sm text-muted-foreground">
              MP4, MOV, or WebM
            </p>
          </div>
        </button>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            className="h-11 min-w-0 w-full rounded-xl"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-4" />
            Browse
          </Button>
          <Button
            variant="outline"
            className="h-11 min-w-0 w-full rounded-xl border-black/10 bg-white"
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera className="size-4" />
            Record
          </Button>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-center text-sm text-destructive">{error}</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
