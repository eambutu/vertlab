import { CUSTOM_MODE, parseMode } from "./metrics";

export const COMPARE_MODE = "compare";
export const MODE_STORAGE_KEY = "vertlab.analysisMode";
export const ANALYSIS_OPTIONS = [
  { id: COMPARE_MODE, label: "Compare" },
  { id: "approach-jump", label: "Approach jump" },
  { id: "depth-jump", label: "Depth jump" },
  { id: "ten-five-rsi", label: "10-5 RSI" },
  { id: CUSTOM_MODE, label: "Custom" },
];

export function defaultExercise() {
  try {
    const mode = localStorage.getItem(MODE_STORAGE_KEY);
    if (mode && ANALYSIS_OPTIONS.some(option => option.id === parseMode(mode).id)) return mode;
  } catch { /* Storage can be unavailable. */ }
  return COMPARE_MODE;
}
