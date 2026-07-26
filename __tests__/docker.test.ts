import { afterEach, describe, expect, it, vi } from "vitest";

const execMock = vi.fn();

vi.mock("child_process", () => ({
  exec: (
    cmd: string,
    cb: (error: Error | null, stdout: string, stderr: string) => void,
  ) => execMock(cmd, cb),
}));

// Dynamic import after mocks are registered
const { Docker } = await import("../src/docker.js");

/** Helper: return a successful exec callback */
function execSuccess(stdout = "abc123\n") {
  return (
    _cmd: string,
    cb: (err: null, stdout: string, stderr: string) => void,
  ) => {
    cb(null, stdout, "");
  };
}

/** Helper: return a failing exec callback */
function execFailure(message: string, code = 1) {
  return (
    _cmd: string,
    cb: (err: Error, stdout: string, stderr: string) => void,
  ) => {
    const err = new Error(message) as Error & { code: number };
    err.code = code;
    cb(err, "", message);
  };
}

describe("Docker", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── pull ──────────────────────────────────────────────────────────

  describe("pull", () => {
    it("runs docker pull with the image", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.pull("sonarqube:25.5.0.107428-community");

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe(
        "docker pull 'sonarqube:25.5.0.107428-community'",
      );
    });

    it("rejects when docker pull fails", async () => {
      execMock.mockImplementation(execFailure("pull failed"));

      await expect(Docker.pull("bad-image")).rejects.toThrow(
        "docker command failed",
      );
    });
  });

  // ── run ───────────────────────────────────────────────────────────

  describe("run", () => {
    it("runs docker run -d with image only", async () => {
      execMock.mockImplementation(execSuccess("container-id-123\n"));

      const id = await Docker.run({ image: "alpine" });

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe("docker run -d 'alpine'");
      expect(id).toBe("container-id-123");
    });

    it("includes --name when provided", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.run({ image: "alpine", name: "my-container" });

      expect(execMock.mock.calls[0][0]).toBe(
        "docker run -d --name 'my-container' 'alpine'",
      );
    });

    it("includes -p when port is provided", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.run({ image: "alpine", port: "9234:9000" });

      expect(execMock.mock.calls[0][0]).toBe(
        "docker run -d -p '9234:9000' 'alpine'",
      );
    });

    it("includes --network when provided", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.run({ image: "alpine", network: "scanwise" });

      expect(execMock.mock.calls[0][0]).toBe(
        "docker run -d --network 'scanwise' 'alpine'",
      );
    });

    it("includes --rm flag when true", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.run({ image: "alpine", rm: true });

      expect(execMock.mock.calls[0][0]).toBe("docker run -d --rm 'alpine'");
    });

    it("does not include --rm when false or omitted", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.run({ image: "alpine", rm: false });

      expect(execMock.mock.calls[0][0]).toBe("docker run -d 'alpine'");
    });

    it("includes -e for each env var", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.run({
        image: "alpine",
        env: { FOO: "bar", BAZ: "qux" },
      });

      expect(execMock.mock.calls[0][0]).toBe(
        "docker run -d -e 'FOO=bar' -e 'BAZ=qux' 'alpine'",
      );
    });

    it("includes -v when volume is provided", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.run({
        image: "alpine",
        volume: "/host/path:/container/path",
      });

      expect(execMock.mock.calls[0][0]).toBe(
        "docker run -d -v '/host/path:/container/path' 'alpine'",
      );
    });

    it("combines all options", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.run({
        image: "sonarqube:lts-community",
        name: "sonar-server",
        port: "9234:9000",
        network: "scanwise",
        rm: true,
        env: { SONAR_ES_BOOTSTRAP_CHECKS_DISABLE: "true" },
        volume: "/src:/usr/src",
      });

      expect(execMock.mock.calls[0][0]).toBe(
        "docker run -d " +
          "--name 'sonar-server' " +
          "-p '9234:9000' " +
          "--network 'scanwise' " +
          "--rm " +
          "-e 'SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true' " +
          "-v '/src:/usr/src' " +
          "'sonarqube:lts-community'",
      );
    });

    it("rejects when docker run fails", async () => {
      execMock.mockImplementation(execFailure("cannot bind port"));

      await expect(Docker.run({ image: "alpine" })).rejects.toThrow(
        "docker command failed",
      );
    });

    it("trims trailing newline from container ID", async () => {
      execMock.mockImplementation(execSuccess("abc123def\n\n"));

      const id = await Docker.run({ image: "alpine" });

      expect(id).toBe("abc123def");
    });
  });

  // ── stop ──────────────────────────────────────────────────────────

  describe("stop", () => {
    it("runs docker stop with the container name", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.stop("sonar-server");

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe("docker stop 'sonar-server'");
    });

    it("rejects when docker stop fails", async () => {
      execMock.mockImplementation(execFailure("no such container"));

      await expect(Docker.stop("nonexistent")).rejects.toThrow(
        "docker command failed",
      );
    });
  });

  // ── rm ────────────────────────────────────────────────────────────

  describe("rm", () => {
    it("runs docker rm with the container name", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.rm("sonar-server");

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe("docker rm 'sonar-server'");
    });

    it("rejects when docker rm fails", async () => {
      execMock.mockImplementation(execFailure("conflict"));

      await expect(Docker.rm("running-container")).rejects.toThrow(
        "docker command failed",
      );
    });
  });

  // ── argument escaping ─────────────────────────────────────────────

  describe("argument escaping", () => {
    it("escapes single quotes in image names", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.pull("img'with'quotes");

      // shell-escaping: 'img'\''with'\''quotes'
      expect(execMock.mock.calls[0][0]).toBe(
        "docker pull 'img'\\''with'\\''quotes'",
      );
    });

    it("escapes shell metacharacters in env values", async () => {
      execMock.mockImplementation(execSuccess());

      await Docker.run({
        image: "alpine",
        env: { CMD: "$(malicious)" },
      });

      expect(execMock.mock.calls[0][0]).toContain("'CMD=$(malicious)'");
    });
  });
});
