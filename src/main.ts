import * as core from "@actions/core";
import { Docker } from "./docker.js";
import { parseInputs } from "./inputs.js";

/**
 * Smoke-test orchestrator — validates Docker pull/run/stop/rm in CI.
 * Replaced with full orchestrator in F13.
 */
export async function run(): Promise<void> {
  try {
    const inputs = parseInputs();

    core.info(`Pulling ${inputs.sonarServerImage} …`);
    await Docker.pull(inputs.sonarServerImage);

    core.info(`Starting container on port ${inputs.sonarInstancePort} …`);
    const containerId = await Docker.run({
      image: inputs.sonarServerImage,
      name: "sonar-server",
      port: `${inputs.sonarInstancePort}:9000`,
    });
    core.info(`Container ID: ${containerId}`);

    // Give SonarQube a few seconds to start, then verify it responds
    await new Promise((r) => setTimeout(r, 15_000));
    const resp = await fetch(
      `http://localhost:${inputs.sonarInstancePort}/api/system/status`,
    );
    const status = (await resp.json()) as { status: string };
    core.info(`SonarQube status: ${status.status}`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  } finally {
    core.info("Stopping sonar-server …");
    await Docker.stop("sonar-server").catch(() => {});
    await Docker.rm("sonar-server").catch(() => {});
    core.info("Cleanup complete.");
  }
}
