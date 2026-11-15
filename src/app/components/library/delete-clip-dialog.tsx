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
import { store } from "../../lib/store";
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
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={async () => {
              if (clip) await store.deleteClip(clip.id);
              onDeleted?.();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
