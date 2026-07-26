import { exec } from "node:child_process";
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

/** Pull a Docker image */
export async function dockerPull(image: string): Promise<void> {
  await execAsync(`docker pull ${escapeArg(image)}`);
}

/**
 * Run a Docker container (detached). Returns the container ID.
 * Supports name, port, network, rm, env, and volume options.
 */
export async function dockerRun(opts: DockerRunOptions): Promise<string> {
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
export async function dockerStop(name: string): Promise<void> {
  await execAsync(`docker stop ${escapeArg(name)}`);
}

/** Remove a stopped container */
export async function dockerRm(name: string): Promise<void> {
  await execAsync(`docker rm ${escapeArg(name)}`);
}

/** Create a Docker bridge network */
export async function dockerNetworkCreate(name: string): Promise<void> {
  await execAsync(`docker network create ${escapeArg(name)}`);
}

/** Remove a Docker network */
export async function dockerNetworkRm(name: string): Promise<void> {
  await execAsync(`docker network rm ${escapeArg(name)}`);
}

/** Start a stopped container */
export async function dockerStart(name: string): Promise<void> {
  await execAsync(`docker start ${escapeArg(name)}`);
}

/** Execute a command in a running container. Returns stdout. */
export async function dockerExec(
  container: string,
  cmd: string[],
): Promise<string> {
  const escaped = cmd.map(escapeArg).join(" ");
  return await execAsync(`docker exec ${escapeArg(container)} ${escaped}`);
}

/** Save a Docker image to a tar file */
export async function dockerSave(
  image: string,
  outputPath: string,
): Promise<void> {
  await execAsync(
    `docker save -o ${escapeArg(outputPath)} ${escapeArg(image)}`,
  );
}

/** Load a Docker image from a tar file */
export async function dockerLoad(inputPath: string): Promise<void> {
  await execAsync(`docker load -i ${escapeArg(inputPath)}`);
}

/** Check whether a container or image exists (returns true/false, never throws) */
export async function dockerInspect(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`docker inspect ${escapeArg(name)}`, (error) => {
      resolve(!error);
    });
  });
}

/** Fetch logs from a container */
export async function dockerLogs(name: string): Promise<string> {
  return await execAsync(`docker logs ${escapeArg(name)}`);
}
