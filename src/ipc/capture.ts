import { invoke } from ".";
import type { CaptureAction, CaptureMode, CaptureResult, PickedColor } from "../shared/types";
export const captureStart = (mode: CaptureMode, action: CaptureAction): Promise<CaptureResult | null> => invoke("capture_start", { mode, action });
export const captureOpenFolder = (): Promise<void> => invoke("capture_open_folder");
export const capturePickColor = (): Promise<PickedColor | null> => invoke("capture_pick_color");
