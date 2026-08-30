import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { DefaultArtifactClient } from "@actions/artifact";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { restoreDockerCache, saveDockerCache } from "./cache.js";
import {
  dockerNetworkCreate,
  dockerNetworkRm,
  dockerPull,
  dockerRm,
  dockerRun,
  dockerStop,
} from "./docker.js";
import { parseInputs } from "./inputs.js";
import { generateHotspotsReportMd, generateIssuesReportMd } from "./reports.js";
import { SonarQube } from "./sonarqube.js";
import { generateAnalysisSummary } from "./summary.js";
import type { ActionInputs, SonarHotspot, SonarIssue } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────

async function execPreScanScript(script: string): Promise<void> {
  core.info("Running pre-scan script …");
  const isFile = existsSync(script);

  let cmd: string;
  if (isFile) {
    cmd = `sh -e '${script}'`;
  } else {
    await writeFile("/tmp/pre-scan.sh", script, { mode: 0o755 }); // NOSONAR — standard temp location
    cmd = "sh -e /tmp/pre-scan.sh";
  }
  await new Promise<void>((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      // NOSONAR — pre-scan script is the feature
      if (stdout) {
        core.info(stdout.trim());
      }
      if (stderr) {
        core.warning(stderr.trim());
      }
      if (error) {
        reject(
          new Error(
            `Pre-scan script failed [exit ${error.code}]: ${stderr ?? error.message}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
  core.info("Pre-scan script completed.");
}

interface ReportResults {
  newIssues: SonarIssue[];
  newHotspots: SonarHotspot[];
  newArtifactUrl?: string;
  overallArtifactUrl?: string;
}

async function generateReports(
  sq: SonarQube,
  inputs: ActionInputs,
  projectKey: string,
  containerName: string,
): Promise<ReportResults> {
  const result: ReportResults = { newIssues: [], newHotspots: [] };

  if (inputs.reportsScopes.length === 0) {
    return result;
  }

  core.info("Reindexing issues (may take a few minutes) …");
  await sq.reindexIssues(projectKey);
  await sq.waitForReindex(containerName, 300);
  core.info("Reindex complete.");

  if (inputs.reportsScopes.includes("overall")) {
    core.debug("Generating overall reports …");
    const overallIssues = await sq.fetchAllIssues(projectKey);
    const overallHotspots = await sq.fetchAllHotspots(projectKey);

    await mkdir("reports/overall", { recursive: true });
    await writeFile(
      "reports/overall/issues-report.md",
      generateIssuesReportMd(overallIssues, inputs.sonarProjectName),
    );
    await writeFile(
      "reports/overall/hotspots-report.md",
      generateHotspotsReportMd(overallHotspots, inputs.sonarProjectName),
    );
    core.debug(
      `Overall: ${overallIssues.length} issues, ${overallHotspots.length} hotspots`,
    );
  }

  if (inputs.reportsScopes.includes("new")) {
    core.debug("Generating new-code reports …");
    result.newIssues = await sq.fetchAllIssues(projectKey, {
      createdInLast: inputs.newCodeNDays,
    });

    const allHotspots = await sq.fetchAllHotspots(projectKey);
    const days = parseInt(inputs.newCodeNDays, 10);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    result.newHotspots = allHotspots.filter(
      (h) => new Date(h.creationDate).getTime() >= cutoff,
    );

    await mkdir("reports/new", { recursive: true });
    await writeFile(
      "reports/new/issues-report.md",
      generateIssuesReportMd(result.newIssues, inputs.sonarProjectName),
    );
    await writeFile(
      "reports/new/hotspots-report.md",
      generateHotspotsReportMd(result.newHotspots, inputs.sonarProjectName),
    );
    core.debug(
      `New: ${result.newIssues.length} issues, ${result.newHotspots.length} hotspots`,
    );
  }

  // Upload artifacts
  const artifact = new DefaultArtifactClient();
  const started = Date.now();
  const { owner, repo } = github.context.repo;
  const runId = github.context.runId;
  const artifactBase = `https://github.com/${owner}/${repo}/actions/runs/${runId}/artifacts`;

  if (inputs.reportsScopes.includes("overall")) {
    const name = `sonar-overall-reports-${started}`;
    core.debug(`Uploading artifact "${name}" …`);
    const uploadResult = await artifact.uploadArtifact(
      name,
      [
        "reports/overall/issues-report.md",
        "reports/overall/hotspots-report.md",
      ],
      ".",
      { retentionDays: inputs.reportsRetentionDays },
    );
    result.overallArtifactUrl = `${artifactBase}/${uploadResult.id}`;
    core.setOutput("overall-reports-artifact-id", uploadResult.id);
    core.info(`Overall reports: ${result.overallArtifactUrl}`);
  }

  if (inputs.reportsScopes.includes("new")) {
    const name = `sonar-new-reports-${started}`;
    core.debug(`Uploading artifact "${name}" …`);
    const uploadResult = await artifact.uploadArtifact(
      name,
      ["reports/new/issues-report.md", "reports/new/hotspots-report.md"],
      ".",
      { retentionDays: inputs.reportsRetentionDays },
    );
    result.newArtifactUrl = `${artifactBase}/${uploadResult.id}`;
    core.setOutput("new-reports-artifact-id", uploadResult.id);
    core.info(`New-code reports: ${result.newArtifactUrl}`);
  }

  return result;
}

async function postPrComment(summary: string, token: string): Promise<void> {
  if (github.context.eventName !== "pull_request") {
    return;
  }

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Pass it via with.github-token or env.GITHUB_TOKEN. " +
        "See https://github.com/mammothb/sonarqube-ce#pr-comments",
    );
  }

  core.info("Posting PR comment …");
  const octokit = github.getOctokit(token);
  const header = "## SonarQube Analysis Summary";
  const body = `${header}\n\n${summary}`;

  const { data: comments } = await octokit.rest.issues.listComments({
    ...github.context.repo,
    issue_number: github.context.issue.number,
  });

  const botComment = comments.find(
    (c) => c.user?.type === "Bot" && c.body?.includes(header),
  );

  if (botComment) {
    await octokit.rest.issues.updateComment({
      ...github.context.repo,
      comment_id: botComment.id,
      body,
    });
    core.info("PR comment updated.");
  } else {
    await octokit.rest.issues.createComment({
      ...github.context.repo,
      issue_number: github.context.issue.number,
      body,
    });
    core.info("PR comment created.");
  }
}

// ── Main orchestration ───────────────────────────────────────────────

// Shared between the `main` and `post` phases — both must target the same
// server instance, port, and credentials.
const NETWORK_NAME = "sq-network";
const CONTAINER_NAME = "sonar-server";
const SQ_PORT = "9234";
const ADMIN_PASSWORD = "Son@rless123";

/**
 * Restore the Docker images from cache or pull them. Returns true on a cache
 * hit (callers skip their own cache-save on a miss).
 */
async function pullImages(
  inputs: ActionInputs,
  includeScanner: boolean,
): Promise<boolean> {
  core.debug("Checking Docker image cache …");
  const cacheHit = await restoreDockerCache(
    inputs.sonarServerImage,
    includeScanner ? inputs.sonarScannerImage : undefined,
  );

  if (cacheHit) {
    core.info("Docker image cache hit — skipping pull.");
    return true;
  }

  core.info(`Pulling ${inputs.sonarServerImage} …`);
  await dockerPull(inputs.sonarServerImage);
  if (includeScanner) {
    core.debug(`Pulling ${inputs.sonarScannerImage} …`);
    await dockerPull(inputs.sonarScannerImage);
  }
  return false;
}

/** Finalize after a scan: quality gate, metrics, reports, summary, PR comment. */
async function finalize(
  sq: SonarQube,
  inputs: ActionInputs,
  projectKey: string,
  containerName: string,
): Promise<void> {
  // ── Quality gate ──────────────────────────────────────────────
  core.info("Waiting for quality gate (timeout: 120s) …");
  await sq.waitForQualityGate(projectKey, 120);
  const qg = await sq.projectStatus(projectKey);
  core.info(`Quality gate: ${qg.projectStatus.status}`);

  // ── Metrics ───────────────────────────────────────────────────
  const metricKeys = [
    "bugs",
    "vulnerabilities",
    "code_smells",
    "quality_gate_details",
    "violations",
    "duplicated_lines_density",
    "ncloc",
    "coverage",
    "reliability_rating",
    "security_rating",
    "security_review_rating",
    "sqale_rating",
    "security_hotspots",
    "open_issues",
    "alert_status",
  ];
  core.debug("Fetching metrics …");
  const metrics = await sq.measures(projectKey, metricKeys);
  const metricsPath = "./sonar-metrics.json";
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  core.info(`Metrics written to ${metricsPath}`);

  // ── Reports ───────────────────────────────────────────────────
  const { newIssues, newHotspots, newArtifactUrl, overallArtifactUrl } =
    await generateReports(sq, inputs, projectKey, containerName);

  // ── Step summary ──────────────────────────────────────────────
  const summary = generateAnalysisSummary({
    metrics,
    newIssues,
    newHotspots,
    newArtifactUrl,
    overallArtifactUrl,
  });
  core.summary.addRaw(summary);
  await core.summary.write();
  core.setOutput("analysis-summary", summary);
  core.info("Step summary written.");

  // ── PR comment ───────────────────────────────────────────────
  if (inputs.generatePrComment) {
    await postPrComment(summary, inputs.githubToken);
  }
}

/** Tear down the SonarQube container and Docker network (best-effort). */
async function cleanup(
  containerName: string,
  networkName: string,
): Promise<void> {
  core.info(`Stopping ${containerName} …`);
  await dockerStop(containerName).catch(() => {});
  await dockerRm(containerName).catch(() => {});
  core.debug(`Removing network ${networkName} …`);
  await dockerNetworkRm(networkName).catch(() => {});
  core.info("Cleanup complete.");
}

/** Detect whether the action is running in its `post:` phase. */
export function currentPhase(): "main" | "post" {
  return core.getState("isPost") === "true" ? "post" : "main";
}

/**
 * Entry point for the `post:` phase. Reads saved state and finalizes the scan.
 * No-op when no state was saved (e.g. `scan-mode: cli` already finalized
 * inline).
 */
export async function runPost(): Promise<void> {
  const projectKey = core.getState("projectKey");
  if (!projectKey) {
    return; // Nothing to finalize — `scan-mode: cli` already finalized inline.
  }

  try {
    const inputs = parseInputs();
    const sq = new SonarQube(`http://localhost:${SQ_PORT}`, {
      user: "admin",
      pass: ADMIN_PASSWORD,
    });

    core.info("Finalizing scan …");
    await finalize(sq, inputs, projectKey, CONTAINER_NAME);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  } finally {
    await cleanup(CONTAINER_NAME, NETWORK_NAME);
  }
}

export async function run(): Promise<void> {
  const tokenName = `scan-${Date.now()}`;
  // When true (scan-mode: none reached the handoff point), the server must
  // stay up for later steps, so cleanup is skipped.
  let keepServer = false;

  try {
    const inputs = parseInputs();

    if (inputs.preScanScript) {
      await execPreScanScript(inputs.preScanScript);
    }

    // ── Docker setup ──────────────────────────────────────────────
    const isNone = inputs.scanMode === "none";
    const cacheHit = await pullImages(inputs, !isNone);

    // In server-only mode, cache the server image immediately: no scan
    // follows, and the CLI-mode cache save at the end is skipped by the
    // early return.
    if (isNone && !cacheHit) {
      core.debug("Saving Docker images to cache …");
      await saveDockerCache(inputs.sonarServerImage).catch((err) =>
        core.warning(`Cache save failed: ${err}`),
      );
      core.debug("Cache saved.");
    }

    core.debug(`Creating network ${NETWORK_NAME} …`);
    await dockerNetworkCreate(NETWORK_NAME);

    core.debug(`Starting SonarQube on port ${SQ_PORT} …`);
    await dockerRun({
      image: inputs.sonarServerImage,
      name: CONTAINER_NAME,
      port: `${SQ_PORT}:9000`,
      network: NETWORK_NAME,
    });

    // ── SonarQube bootstrap ───────────────────────────────────────
    const baseUrl = `http://localhost:${SQ_PORT}`;
    const sq = new SonarQube(baseUrl, { user: "admin", pass: "admin" });

    core.info("Waiting for SonarQube to boot (timeout: 180s) …");
    await sq.waitForUp(180);
    core.info("SonarQube is UP.");

    core.debug("Changing default password …");
    await sq.changePassword(ADMIN_PASSWORD);
    sq.setAuth({ user: "admin", pass: ADMIN_PASSWORD });

    // ── Project + Token ───────────────────────────────────────────
    const projectKey = inputs.sonarProjectName.replace(
      /[^a-zA-Z0-9._:-]+/g,
      "-",
    );
    core.debug(
      `Creating project "${inputs.sonarProjectName}" (key: ${projectKey}) …`,
    );
    await sq.createProject(inputs.sonarProjectName, projectKey);
    await sq.setHomepage(projectKey);

    core.debug("Generating user token …");
    const token = await sq.generateToken(tokenName);
    core.debug(`Token: ${token.slice(0, 8)}…`);

    // ── Expose connection outputs (always) ────────────────────────
    core.setSecret(token);
    core.setOutput("sonar-host-url", baseUrl);
    core.setOutput("sonar-project-key", projectKey);
    core.setOutput("sonar-token", token);

    // ── Server-only mode: hand off scanning to later steps ────────
    if (inputs.scanMode === "none") {
      if (inputs.sonarSourcePath !== ".") {
        core.warning(
          "sonar-source-path is ignored when scan-mode is none: the .NET scanner analyzes what the build compiles.",
        );
      }
      core.saveState("projectKey", projectKey);
      core.saveState("token", token);
      keepServer = true;
      return;
    }

    // ── Scanner ───────────────────────────────────────────────────
    const workspace = process.env.GITHUB_WORKSPACE ?? ".";
    core.info("Running scanner …");
    await dockerRun({
      image: inputs.sonarScannerImage,
      rm: true,
      network: NETWORK_NAME,
      env: {
        SONAR_HOST_URL: `http://${CONTAINER_NAME}:9000`,
        SONAR_TOKEN: token,
        SONAR_SCANNER_OPTS: [
          `-Dsonar.projectKey=${projectKey}`,
          `-Dsonar.sources=${inputs.sonarSourcePath}`,
          inputs.sonarOptions,
        ]
          .filter(Boolean)
          .join(" "),
      },
      volume: `${workspace}:/usr/src`,
    });
    core.info("Scanner finished.");

    // ── Finalize ──────────────────────────────────────────────────
    await finalize(sq, inputs, projectKey, CONTAINER_NAME);

    // ── Cache save (only if cache miss) ────────────────────────────
    if (!cacheHit) {
      core.debug("Saving Docker images to cache …");
      await saveDockerCache(
        inputs.sonarServerImage,
        inputs.sonarScannerImage,
      ).catch((err) => core.warning(`Cache save failed: ${err}`));
      core.debug("Cache saved.");
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  } finally {
    if (!keepServer) {
      await cleanup(CONTAINER_NAME, NETWORK_NAME);
    }
  }
}
