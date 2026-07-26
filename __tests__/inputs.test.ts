import { afterEach, describe, expect, it, vi } from "vitest";
import * as core from "../__fixtures__/core.js";

vi.mock("@actions/core", async () => {
  return await import("../__fixtures__/core.js");
});

// Dynamic import after mocks are registered
const { parseInputs } = await import("../src/inputs.js");

/**
 * Helper: return a mock implementation that provides defaults matching
 * action.yml. Pass overrides for individual inputs.
 */
function mockInputs(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    "sonar-project-name": "myrepo",
    "sonar-source-path": ".",
    "sonar-server-image": "sonarqube:25.5.0.107428-community",
    "sonar-scanner-image": "sonarsource/sonar-scanner-cli:11.3",
    "sonar-options": "",
    "pre-scan-script": "",
    "generate-pr-comment": "false",
    "new-code-n-days": "30d",
    "reports-scopes": "[]",
    "reports-retention-days": "7",
  };
  core.getInput.mockImplementation(
    (name: string) => overrides[name] ?? defaults[name] ?? "",
  );
}

describe("parseInputs", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  // ── Defaults ──────────────────────────────────────────────────────

  it("returns defaults matching action.yml when no inputs are set", () => {
    mockInputs();

    const result = parseInputs();

    expect(result).toEqual({
      sonarProjectName: "myrepo",
      sonarSourcePath: ".",
      sonarServerImage: "sonarqube:25.5.0.107428-community",
      sonarScannerImage: "sonarsource/sonar-scanner-cli:11.3",
      sonarOptions: "",
      preScanScript: "",
      githubToken: "",
      generatePrComment: false,
      newCodeNDays: "30d",
      reportsScopes: [],
      reportsRetentionDays: 7,
    });
  });

  // ── Passthrough ───────────────────────────────────────────────────

  it("passes through all values when set", () => {
    mockInputs({
      "sonar-project-name": "My Project",
      "sonar-source-path": "src",
      "sonar-server-image": "sonarqube:lts-community",
      "sonar-scanner-image": "sonarsource/sonar-scanner-cli:12.0",
      "sonar-options": "-Dsonar.verbose=true",
      "pre-scan-script": "echo hello",
      "generate-pr-comment": "true",
      "new-code-n-days": "60d",
      "reports-scopes": '["overall","new"]',
      "reports-retention-days": "14",
    });

    const result = parseInputs();

    expect(result).toEqual({
      sonarProjectName: "My Project",
      sonarSourcePath: "src",
      sonarServerImage: "sonarqube:lts-community",
      sonarScannerImage: "sonarsource/sonar-scanner-cli:12.0",
      sonarOptions: "-Dsonar.verbose=true",
      preScanScript: "echo hello",
      githubToken: "",
      generatePrComment: true,
      newCodeNDays: "60d",
      reportsScopes: ["overall", "new"],
      reportsRetentionDays: 14,
    });
  });

  // ── Server image validation ───────────────────────────────────────

  it("rejects non-community server image", () => {
    mockInputs({ "sonar-server-image": "sonarqube:developer" });
    expect(() => parseInputs()).toThrow(
      'sonar-server-image must be a Community Edition image (must contain "community"), got: "sonarqube:developer"',
    );
  });

  it("accepts image with 'community' anywhere in tag", () => {
    mockInputs({
      "sonar-server-image": "sonarqube:25.5.0.107428-community",
    });
    expect(() => parseInputs()).not.toThrow();
  });

  // ── reportsScopes validation ──────────────────────────────────────

  it("parses reports-scopes JSON array", () => {
    mockInputs({ "reports-scopes": '["overall","new"]' });
    expect(parseInputs().reportsScopes).toEqual(["overall", "new"]);
  });

  it("parses single scope", () => {
    mockInputs({ "reports-scopes": '["new"]' });
    expect(parseInputs().reportsScopes).toEqual(["new"]);
  });

  it("parses empty scope array", () => {
    mockInputs({ "reports-scopes": "[]" });
    expect(parseInputs().reportsScopes).toEqual([]);
  });

  it("rejects invalid JSON for reports-scopes", () => {
    mockInputs({ "reports-scopes": "not-json" });
    expect(() => parseInputs()).toThrow(/reports-scopes must be a JSON array/);
  });

  it("rejects non-array JSON for reports-scopes", () => {
    mockInputs({ "reports-scopes": '"a string"' });
    expect(() => parseInputs()).toThrow(/reports-scopes must be a JSON array/);
  });

  it("rejects invalid scope values", () => {
    mockInputs({ "reports-scopes": '["overall","invalid"]' });
    expect(() => parseInputs()).toThrow(/reports-scopes must be a JSON array/);
  });

  // ── reportsRetentionDays validation ───────────────────────────────

  it("rejects negative retention days", () => {
    mockInputs({ "reports-retention-days": "-1" });
    expect(() => parseInputs()).toThrow(
      "reports-retention-days must be a non-negative integer",
    );
  });

  it("rejects non-integer retention days", () => {
    mockInputs({ "reports-retention-days": "3.14" });
    expect(() => parseInputs()).toThrow(
      "reports-retention-days must be a non-negative integer",
    );
  });

  it("rejects alphanumeric retention days", () => {
    mockInputs({ "reports-retention-days": "7abc" });
    expect(() => parseInputs()).toThrow(
      "reports-retention-days must be a non-negative integer",
    );
  });

  it("accepts zero retention days", () => {
    mockInputs({ "reports-retention-days": "0" });
    expect(() => parseInputs()).not.toThrow();
    expect(parseInputs().reportsRetentionDays).toBe(0);
  });

  // ── generatePrComment coercion ────────────────────────────────────

  it("coerces generate-pr-comment true", () => {
    mockInputs({ "generate-pr-comment": "true" });
    expect(parseInputs().generatePrComment).toBe(true);
  });

  it("coerces generate-pr-comment false for any non-'true' value", () => {
    mockInputs({ "generate-pr-comment": "FALSE" });
    expect(parseInputs().generatePrComment).toBe(false);
  });

  // ── Optional string inputs (no default in action.yml) ─────────────

  it("returns empty string for sonarOptions when not set", () => {
    mockInputs();
    expect(parseInputs().sonarOptions).toBe("");
  });

  it("returns empty string for preScanScript when not set", () => {
    mockInputs();
    expect(parseInputs().preScanScript).toBe("");
  });

  // ── github-token ──────────────────────────────────────────────────

  it("returns github-token from input when set", () => {
    mockInputs({ "github-token": "ghp_explicit" });
    expect(parseInputs().githubToken).toBe("ghp_explicit");
  });

  it("falls back to GITHUB_TOKEN env var when input is empty", () => {
    mockInputs();
    vi.stubEnv("GITHUB_TOKEN", "ghp_from_env");
    expect(parseInputs().githubToken).toBe("ghp_from_env");
    vi.unstubAllEnvs();
  });

  it("returns empty string when neither input nor env is set", () => {
    mockInputs();
    expect(parseInputs().githubToken).toBe("");
  });
});
