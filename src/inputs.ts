import * as core from "@actions/core";
import type { ActionInputs } from "./types.js";

/** Read + validate all action inputs. Returns typed ActionInputs or throws. */
export function parseInputs(): ActionInputs {
  // ── Read raw strings (defaults come from action.yml) ────────────────
  const sonarProjectName = core.getInput("sonar-project-name");
  const sonarProjectKey = core.getInput("sonar-project-key");
  const sonarSourcePath = core.getInput("sonar-source-path");
  const sonarMetricsPath = core.getInput("sonar-metrics-path");
  const sonarInstancePort = core.getInput("sonar-instance-port");
  const sonarServerImage = core.getInput("sonar-server-image");
  const sonarScannerImage = core.getInput("sonar-scanner-image");
  const sonarOptions = core.getInput("sonar-options");
  const preScanScript = core.getInput("pre-scan-script");
  const generatePrCommentRaw = core.getInput("generate-pr-comment");
  const newCodeNDays = core.getInput("new-code-n-days");
  const reportsScopesRaw = core.getInput("reports-scopes");
  const reportsRetentionDaysRaw = core.getInput("reports-retention-days");

  // ── Validate port ───────────────────────────────────────────────────
  if (!/^\d+$/.test(sonarInstancePort)) {
    throw new Error(
      `sonar-instance-port must be a numeric string, got: "${sonarInstancePort}"`,
    );
  }
  const portNum = parseInt(sonarInstancePort, 10);
  if (portNum < 1024 || portNum > 65535) {
    throw new Error(
      `sonar-instance-port must be between 1024–65535, got: ${portNum}`,
    );
  }

  // ── Validate server image (Community Edition only) ───────────────────
  if (!sonarServerImage.includes("community")) {
    throw new Error(
      `sonar-server-image must be a Community Edition image (must contain "community"), got: "${sonarServerImage}"`,
    );
  }

  // ── Parse reports scopes ───────────────────────────────────────────
  let reportsScopes: ("overall" | "new")[];
  try {
    const parsed = JSON.parse(reportsScopesRaw);
    if (!Array.isArray(parsed)) {
      throw new Error("not an array");
    }
    for (const item of parsed) {
      if (item !== "overall" && item !== "new") {
        throw new Error(`invalid scope: "${String(item)}"`);
      }
    }
    reportsScopes = parsed as ("overall" | "new")[];
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `reports-scopes must be a JSON array of "overall" / "new", got: "${reportsScopesRaw}" (${reason})`,
    );
  }

  // ── Validate retention days ────────────────────────────────────────
  if (!/^\d+$/.test(reportsRetentionDaysRaw)) {
    throw new Error(
      `reports-retention-days must be a non-negative integer, got: "${reportsRetentionDaysRaw}"`,
    );
  }
  const reportsRetentionDays = parseInt(reportsRetentionDaysRaw, 10);

  // ── Coerce boolean ─────────────────────────────────────────────────
  const generatePrComment = generatePrCommentRaw === "true";

  return {
    sonarProjectName,
    sonarProjectKey,
    sonarSourcePath,
    sonarMetricsPath,
    sonarInstancePort,
    sonarServerImage,
    sonarScannerImage,
    sonarOptions,
    preScanScript,
    generatePrComment,
    newCodeNDays,
    reportsScopes,
    reportsRetentionDays,
  };
}
