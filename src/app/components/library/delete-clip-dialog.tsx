import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { buttonVariants } from "../ui/button";
import { toast } from "sonner";
import { isCloudBacked, store, useOnline } from "../../lib/store";
import type { Clip } from "../../lib/store";
import { modeLabel } from "./parts";

export function DeleteClipDialog({
  clip,
  onOpenChange,
  onDeleted,
}: {
  clip: Clip | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const online = useOnline();
  return (
    <AlertDialog open={!!clip} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete this {clip && clip.mode !== "compare" ? `${modeLabel(clip)} ` : ""}clip?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The video, keyframes and result are removed, and any link that
            includes it stops showing it. This can't be undone.
            {isCloudBacked && !online && " Cloud copies and links update when Vertlab syncs."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={async () => {
              try {
                if (clip) await store.deleteClip(clip.id);
                onDeleted?.();
              } catch {
                toast.error("Couldn't delete the clip. Try again.");
              }
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
