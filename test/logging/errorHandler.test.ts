import { describe, expect, it, vi } from "vitest";
import { runWithErrorLogging } from "../../src/logging/errorHandler";
import * as logger from "../../src/logging/logger";

vi.mock("../../src/logging/logger", () => ({ log: vi.fn() }));

describe("runWithErrorLogging", () => {
  it("runs the function normally when it doesn't throw", () => {
    const fn = vi.fn();

    runWithErrorLogging(fn);

    expect(fn).toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("logs a structured error and swallows the exception when the function throws", () => {
    const error = new Error("boom");
    const fn = vi.fn(() => {
      throw error;
    });

    expect(() => runWithErrorLogging(fn)).not.toThrow();
    expect(logger.log).toHaveBeenCalledWith("error", { message: "boom", stack: error.stack });
  });

  it("handles a thrown non-Error value without crashing", () => {
    const fn = vi.fn(() => {
      throw "not an error object";
    });

    expect(() => runWithErrorLogging(fn)).not.toThrow();
    expect(logger.log).toHaveBeenCalledWith("error", {
      message: "not an error object",
      stack: undefined
    });
  });
});
