import { writeFile } from "node:fs/promises";
import * as core from "@actions/core";
import {
  dockerNetworkCreate,
  dockerNetworkRm,
  dockerPull,
  dockerRm,
  dockerRun,
  dockerStop,
} from "./docker.js";
import { parseInputs } from "./inputs.js";
import { SonarQube } from "./sonarqube.js";
import { generateAnalysisSummary } from "./summary.js";

export async function run(): Promise<void> {
  const networkName = "sq-network";
  const containerName = "sonar-server";
  const tokenName = `scan-${Date.now()}`;

  try {
    const inputs = parseInputs();

    // ── Docker setup ──────────────────────────────────────────────
    core.info(`Pulling ${inputs.sonarServerImage} …`);
    await dockerPull(inputs.sonarServerImage);

    core.info(`Pulling ${inputs.sonarScannerImage} …`);
    await dockerPull(inputs.sonarScannerImage);

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

    // ── Step summary ──────────────────────────────────────────────
    const summary = generateAnalysisSummary({
      metrics,
      newIssues: [],
      newHotspots: [],
    });
    core.summary.addRaw(summary);
    await core.summary.write();
    core.setOutput("analysis-summary", summary);
    core.info("Step summary written.");
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
