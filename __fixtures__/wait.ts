import { vi } from "vitest";

export const wait = vi.fn<() => Promise<string>>();
