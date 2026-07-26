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
import type { SonarHotspot, SonarIssue } from "./types.js";

export async function run(): Promise<void> {
  const networkName = "sq-network";
  const containerName = "sonar-server";
  const tokenName = `scan-${Date.now()}`;

  try {
    const inputs = parseInputs();

    // ── Pre-scan script ───────────────────────────────────────────
    if (inputs.preScanScript) {
      core.info("Running pre-scan script …");
      const script = inputs.preScanScript;
      const isFile = existsSync(script);

      let cmd: string;
      if (isFile) {
        cmd = `sh -e '${script}'`;
      } else {
        // Inline script — write to temp file and execute
        await writeFile("/tmp/pre-scan.sh", script, { mode: 0o755 });
        cmd = "sh -e /tmp/pre-scan.sh";
      }

      await new Promise<void>((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
          if (stdout) {
            core.info(stdout.trim());
          }
          if (stderr) {
            core.warning(stderr.trim());
          }
          if (error) {
            reject(
              new Error(
                `Pre-scan script failed [exit ${error.code}]: ${stderr || error.message}`,
              ),
            );
            return;
          }
          resolve();
        });
      });
      core.info("Pre-scan script completed.");
    }

    // ── Docker setup ──────────────────────────────────────────────
    core.info("Checking Docker image cache …");
    const cacheHit = await restoreDockerCache(
      inputs.sonarServerImage,
      inputs.sonarScannerImage,
    );

    if (cacheHit) {
      core.info("Cache hit — skipping pull.");
    } else {
      core.info(`Pulling ${inputs.sonarServerImage} …`);
      await dockerPull(inputs.sonarServerImage);

      core.info(`Pulling ${inputs.sonarScannerImage} …`);
      await dockerPull(inputs.sonarScannerImage);
    }

    core.info(`Creating network ${networkName} …`);
    await dockerNetworkCreate(networkName);

    core.info(`Starting SonarQube on port ${inputs.sonarInstancePort} …`);
    await dockerRun({
      image: inputs.sonarServerImage,
      name: containerName,
      port: `${inputs.sonarInstancePort}:9000`,
      network: networkName,
    });

    // ── SonarQube bootstrap ───────────────────────────────────────
    const baseUrl = `http://localhost:${inputs.sonarInstancePort}`;
    const sq = new SonarQube(baseUrl, { user: "admin", pass: "admin" });

    core.info("Waiting for SonarQube to boot (timeout: 180s) …");
    await sq.waitForUp(180);
    core.info("SonarQube is UP.");

    core.info("Changing default password …");
    const newPassword = "Son@rless123";
    await sq.changePassword(newPassword);
    sq.setAuth({ user: "admin", pass: newPassword });

    // ── Project + Token ───────────────────────────────────────────
    core.info(`Creating project "${inputs.sonarProjectName}" …`);
    await sq.createProject(inputs.sonarProjectName);
    await sq.setHomepage(inputs.sonarProjectName);

    core.info("Generating user token …");
    const token = await sq.generateToken(tokenName);
    core.info(`Token: ${token.slice(0, 8)}…`);

    // ── Scanner ───────────────────────────────────────────────────
    const workspace = process.env.GITHUB_WORKSPACE ?? ".";
    core.info("Running scanner …");
    await dockerRun({
      image: inputs.sonarScannerImage,
      rm: true,
      network: networkName,
      env: {
        SONAR_HOST_URL: `http://${containerName}:9000`,
        SONAR_TOKEN: token,
        SONAR_SCANNER_OPTS: [
          `-Dsonar.projectKey=${inputs.sonarProjectName}`,
          `-Dsonar.sources=${inputs.sonarSourcePath}`,
          inputs.sonarOptions,
        ]
          .filter(Boolean)
          .join(" "),
      },
      volume: `${workspace}:/usr/src`,
    });
    core.info("Scanner finished.");

    // ── Quality gate ──────────────────────────────────────────────
    core.info("Waiting for quality gate (timeout: 120s) …");
    await sq.waitForQualityGate(inputs.sonarProjectName, 120);
    const qg = await sq.projectStatus(inputs.sonarProjectName);
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
    core.info("Fetching metrics …");
    const metrics = await sq.measures(inputs.sonarProjectName, metricKeys);
    await writeFile(inputs.sonarMetricsPath, JSON.stringify(metrics, null, 2));
    core.info(`Metrics written to ${inputs.sonarMetricsPath}`);

    // ── Reports (if requested) ────────────────────────────────────
    let newIssues: SonarIssue[] = [];
    let newHotspots: SonarHotspot[] = [];

    if (inputs.reportsScopes.length > 0) {
      core.info("Reindexing issues …");
      await sq.reindexIssues(inputs.sonarProjectName);
      await sq.waitForReindex(containerName, 300);
      core.info("Reindex complete.");

      if (inputs.reportsScopes.includes("overall")) {
        core.info("Generating overall reports …");
        const overallIssues = await sq.fetchAllIssues(inputs.sonarProjectName);
        const overallHotspots = await sq.fetchAllHotspots(
          inputs.sonarProjectName,
        );

        await mkdir("reports/overall", { recursive: true });
        await writeFile(
          "reports/overall/issues-report.md",
          generateIssuesReportMd(overallIssues, inputs.sonarProjectName),
        );
        await writeFile(
          "reports/overall/hotspots-report.md",
          generateHotspotsReportMd(overallHotspots, inputs.sonarProjectName),
        );
        core.info(
          `Overall: ${overallIssues.length} issues, ${overallHotspots.length} hotspots`,
        );
      }

      if (inputs.reportsScopes.includes("new")) {
        core.info("Generating new-code reports …");
        newIssues = await sq.fetchAllIssues(inputs.sonarProjectName, {
          createdInLast: inputs.newCodeNDays,
        });

        const allHotspots = await sq.fetchAllHotspots(inputs.sonarProjectName);
        const days = parseInt(inputs.newCodeNDays, 10);
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        newHotspots = allHotspots.filter(
          (h) => new Date(h.creationDate).getTime() >= cutoff,
        );

        await mkdir("reports/new", { recursive: true });
        await writeFile(
          "reports/new/issues-report.md",
          generateIssuesReportMd(newIssues, inputs.sonarProjectName),
        );
        await writeFile(
          "reports/new/hotspots-report.md",
          generateHotspotsReportMd(newHotspots, inputs.sonarProjectName),
        );
        core.info(
          `New: ${newIssues.length} issues, ${newHotspots.length} hotspots`,
        );
      }

      // Upload artifacts
      const artifact = new DefaultArtifactClient();
      const started = Date.now();
      let newArtifactUrl: string | undefined;
      let overallArtifactUrl: string | undefined;

      const { owner, repo } = github.context.repo;
      const runId = github.context.runId;
      const artifactBase = `https://github.com/${owner}/${repo}/actions/runs/${runId}/artifacts`;

      if (inputs.reportsScopes.includes("overall")) {
        const name = `sonar-overall-reports-${started}`;
        core.info(`Uploading artifact "${name}" …`);
        const result = await artifact.uploadArtifact(
          name,
          [
            "reports/overall/issues-report.md",
            "reports/overall/hotspots-report.md",
          ],
          ".",
          { retentionDays: inputs.reportsRetentionDays },
        );
        overallArtifactUrl = `${artifactBase}/${result.id}`;
        core.setOutput("overall-reports-artifact-id", result.id);
        core.info(`Uploaded: ${overallArtifactUrl}`);
      }

      if (inputs.reportsScopes.includes("new")) {
        const name = `sonar-new-reports-${started}`;
        core.info(`Uploading artifact "${name}" …`);
        const result = await artifact.uploadArtifact(
          name,
          ["reports/new/issues-report.md", "reports/new/hotspots-report.md"],
          ".",
          { retentionDays: inputs.reportsRetentionDays },
        );
        newArtifactUrl = `${artifactBase}/${result.id}`;
        core.setOutput("new-reports-artifact-id", result.id);
        core.info(`Uploaded: ${newArtifactUrl}`);
      }
    }

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
    if (
      github.context.eventName === "pull_request" &&
      inputs.generatePrComment
    ) {
      core.info("Posting PR comment …");
      const token = process.env.GITHUB_TOKEN ?? "";
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

    // ── Cache save (only if cache miss) ────────────────────────────
    if (!cacheHit) {
      core.info("Saving Docker images to cache …");
      await saveDockerCache(
        inputs.sonarServerImage,
        inputs.sonarScannerImage,
      ).catch((err) => core.warning(`Cache save failed: ${err}`));
      core.info("Cache saved.");
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  } finally {
    // ── Cleanup ───────────────────────────────────────────────────
    core.info(`Stopping ${containerName} …`);
    await dockerStop(containerName).catch(() => {});
    await dockerRm(containerName).catch(() => {});
    core.info(`Removing network ${networkName} …`);
    await dockerNetworkRm(networkName).catch(() => {});
    core.info("Cleanup complete.");
  }
}
