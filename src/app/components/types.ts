export interface Keyframe {
  id: string;
  /** Timestamp in seconds (sub-millisecond precision). */
  time: number;
  /** Data URL thumbnail of the captured frame. */
  thumbUrl: string;
}
