import { log } from "./logger";

export function runWithErrorLogging(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (err instanceof Error) {
      log("error", { message: err.message, stack: err.stack });
    } else {
      log("error", { message: String(err), stack: undefined });
    }
  }
}
