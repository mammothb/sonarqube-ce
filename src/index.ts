/**
 * The entrypoint for the action. Dispatches to the `main` or `post` phase:
 * `main` runs the scan; `post` (declared in action.yml) finalizes + cleans up.
 */
import * as core from "@actions/core";
import { currentPhase, run, runPost } from "./main.js";

/* istanbul ignore next */
if (currentPhase() === "post") {
  runPost();
} else {
  core.saveState("isPost", "true");
  run();
}
