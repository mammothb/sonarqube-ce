import { beforeEach, describe, expect, it, vi } from "vitest";

// Entrypoint dispatch: index.js branches on currentPhase(). main.js is stubbed
// so importing index.js does not execute the heavy `run()` orchestration.
// @actions/core is stubbed with spies so saveState can be asserted directly.
const mocks = vi.hoisted(() => ({
  currentPhase: vi.fn<() => "main" | "post">(),
  run: vi.fn<() => Promise<void>>(),
  runPost: vi.fn<() => Promise<void>>(),
  saveState: vi.fn<(name: string, value: string) => void>(),
}));

vi.mock("@actions/core", () => ({
  saveState: mocks.saveState,
}));

vi.mock("../src/main.js", () => ({
  currentPhase: mocks.currentPhase,
  run: mocks.run,
  runPost: mocks.runPost,
}));

describe("entrypoint dispatch", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("post phase runs runPost and not run", async () => {
    mocks.currentPhase.mockReturnValue("post");
    await import("../src/index.js");
    expect(mocks.runPost).toHaveBeenCalledTimes(1);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.saveState).not.toHaveBeenCalled();
  });

  it("main phase runs run and marks isPost state", async () => {
    mocks.currentPhase.mockReturnValue("main");
    await import("../src/index.js");
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.saveState).toHaveBeenCalledWith("isPost", "true");
  });
});
