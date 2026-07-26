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

/**
 * Smoke-test orchestrator — validates Docker + SonarQube API in CI.
 * Replaced with full orchestrator in F13.
 */
export async function run(): Promise<void> {
  const networkName = "sq-network";
  const containerName = "sonar-server";

  try {
    const inputs = parseInputs();

    // ── Docker setup ──────────────────────────────────────────────
    core.info(`Pulling ${inputs.sonarServerImage} …`);
    await dockerPull(inputs.sonarServerImage);

    core.info(`Creating network ${networkName} …`);
    await dockerNetworkCreate(networkName);

    core.info(`Starting container on port ${inputs.sonarInstancePort} …`);
    const containerId = await dockerRun({
      image: inputs.sonarServerImage,
      name: containerName,
      port: `${inputs.sonarInstancePort}:9000`,
      network: networkName,
    });
    core.info(`Container ID: ${containerId}`);

    // ── SonarQube API ─────────────────────────────────────────────
    const baseUrl = `http://localhost:${inputs.sonarInstancePort}`;
    const sq = new SonarQube(baseUrl, { user: "admin", pass: "admin" });

    core.info("Waiting for SonarQube to boot (timeout: 180s) …");
    await sq.waitForUp(180);
    core.info("SonarQube is UP.");

    core.info("Changing default password …");
    const newPassword = "Son@rless123";
    await sq.changePassword(newPassword);

    // Verify new credentials work
    sq.setAuth({ user: "admin", pass: newPassword });
    const status = await sq.systemStatus();
    core.info(`Password change verified — system status: ${status.status}`);

    // ── Project + Token ───────────────────────────────────────────
    core.info(`Creating project "${inputs.sonarProjectName}" …`);
    await sq.createProject(inputs.sonarProjectName);
    await sq.setHomepage(inputs.sonarProjectName);
    core.info("Project created.");

    core.info("Generating user token …");
    const token = await sq.generateToken("e2e-token");
    core.info(`Token: ${token.slice(0, 8)}…`);

    // Verify token works for API access (token as username, empty password)
    const tokenSq = new SonarQube(baseUrl, { user: token, pass: "" });
    const tokenStatus = await tokenSq.systemStatus();
    core.info(`Token auth verified — system status: ${tokenStatus.status}`);
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
