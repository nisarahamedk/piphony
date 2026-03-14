import { describe, expect, test, vi } from "vitest";
import { attemptCleanup } from "../src/core/cleanup.js";

describe("attemptCleanup", () => {
  test("records cleanup failure and continues", async () => {
    const recordFailure = vi.fn();

    await expect(
      attemptCleanup(
        "runtime.stop",
        async () => {
          throw new Error("boom");
        },
        recordFailure,
        "docker",
      ),
    ).resolves.toBeUndefined();

    expect(recordFailure).toHaveBeenCalledWith({
      operation: "runtime.stop",
      target: "docker",
      message: "boom",
      stack: expect.any(String),
    });
  });
});
