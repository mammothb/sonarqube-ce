import { exec } from "child_process";
import type { DockerRunOptions } from "./types.js";

/** Shell-escape a single argument by wrapping in single quotes. */
function escapeArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/** Promisified child_process.exec */
function execAsync(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `docker command failed [exit ${error.code}]: ${stderr || error.message}`,
          ),
        );
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export class Docker {
  /** Pull a Docker image */
  static async pull(image: string): Promise<void> {
    await execAsync(`docker pull ${escapeArg(image)}`);
  }

  /**
   * Run a Docker container (detached). Returns the container ID.
   * Supports name, port, network, rm, env, and volume options.
   */
  static async run(opts: DockerRunOptions): Promise<string> {
    const parts: string[] = ["docker", "run", "-d"];

    if (opts.name) {
      parts.push("--name", escapeArg(opts.name));
    }
    if (opts.port) {
      parts.push("-p", escapeArg(opts.port));
    }
    if (opts.network) {
      parts.push("--network", escapeArg(opts.network));
    }
    if (opts.rm) {
      parts.push("--rm");
    }
    if (opts.env) {
      for (const [key, value] of Object.entries(opts.env)) {
        parts.push("-e", escapeArg(`${key}=${value}`));
      }
    }
    if (opts.volume) {
      parts.push("-v", escapeArg(opts.volume));
    }

    parts.push(escapeArg(opts.image));

    return await execAsync(parts.join(" "));
  }

  /** Stop a running container */
  static async stop(name: string): Promise<void> {
    await execAsync(`docker stop ${escapeArg(name)}`);
  }

  /** Remove a stopped container */
  static async rm(name: string): Promise<void> {
    await execAsync(`docker rm ${escapeArg(name)}`);
  }
}
