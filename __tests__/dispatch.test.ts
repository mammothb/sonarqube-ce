import { describe, expect, it, vi } from "vitest";

vi.mock("@actions/core", async () => {
  return await import("../__fixtures__/core.js");
});

// Real `currentPhase`/`runPost`, with @actions/core mocked via the fixture.
// Importing main.js does not execute `run()` — only the phase helpers are used.
const core = await import("../__fixtures__/core.js");
const { currentPhase, runPost } = await import("../src/main.js");

describe("phase detection", () => {
  it("currentPhase returns main when isPost state is not set", () => {
    core.getState.mockReturnValue("");
    expect(currentPhase()).toBe("main");
  });

  it("currentPhase returns post when isPost state is set", () => {
    core.getState.mockReturnValue("true");
    expect(currentPhase()).toBe("post");
  });

  it("runPost no-ops when no projectKey state is saved", async () => {
    core.getState.mockReturnValue("");
    await expect(runPost()).resolves.toBeUndefined();
  });
});
