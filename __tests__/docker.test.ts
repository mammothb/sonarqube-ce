import { afterEach, describe, expect, it, vi } from "vitest";

const execMock = vi.fn();

vi.mock("node:child_process", () => ({
  exec: (
    cmd: string,
    cb: (error: Error | null, stdout: string, stderr: string) => void,
  ) => execMock(cmd, cb),
}));

// Dynamic import after mocks are registered
const {
  dockerExec,
  dockerInspect,
  dockerLoad,
  dockerLogs,
  dockerNetworkCreate,
  dockerNetworkRm,
  dockerPull,
  dockerRm,
  dockerRun,
  dockerSave,
  dockerStart,
  dockerStop,
} = await import("../src/docker.js");

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

      await dockerPull("sonarqube:25.5.0.107428-community");

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe(
        "docker pull 'sonarqube:25.5.0.107428-community'",
      );
    });

    it("rejects when docker pull fails", async () => {
      execMock.mockImplementation(execFailure("pull failed"));

      await expect(dockerPull("bad-image")).rejects.toThrow(
        "docker command failed",
      );
    });
  });

  // ── run ───────────────────────────────────────────────────────────

  describe("run", () => {
    it("runs docker run -d with image only", async () => {
      execMock.mockImplementation(execSuccess("container-id-123\n"));

      const id = await dockerRun({ image: "alpine" });

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe("docker run -d 'alpine'");
      expect(id).toBe("container-id-123");
    });

    it("includes --name when provided", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerRun({ image: "alpine", name: "my-container" });

      expect(execMock.mock.calls[0][0]).toBe(
        "docker run -d --name 'my-container' 'alpine'",
      );
    });

    it("includes -p when port is provided", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerRun({ image: "alpine", port: "9234:9000" });

      expect(execMock.mock.calls[0][0]).toBe(
        "docker run -d -p '9234:9000' 'alpine'",
      );
    });

    it("includes --network when provided", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerRun({ image: "alpine", network: "scanwise" });

      expect(execMock.mock.calls[0][0]).toBe(
        "docker run -d --network 'scanwise' 'alpine'",
      );
    });

    it("includes --rm flag when true", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerRun({ image: "alpine", rm: true });

      expect(execMock.mock.calls[0][0]).toBe("docker run -d --rm 'alpine'");
    });

    it("does not include --rm when false or omitted", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerRun({ image: "alpine", rm: false });

      expect(execMock.mock.calls[0][0]).toBe("docker run -d 'alpine'");
    });

    it("includes -e for each env var", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerRun({
        image: "alpine",
        env: { FOO: "bar", BAZ: "qux" },
      });

      expect(execMock.mock.calls[0][0]).toBe(
        "docker run -d -e 'FOO=bar' -e 'BAZ=qux' 'alpine'",
      );
    });

    it("includes -v when volume is provided", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerRun({
        image: "alpine",
        volume: "/host/path:/container/path",
      });

      expect(execMock.mock.calls[0][0]).toBe(
        "docker run -d -v '/host/path:/container/path' 'alpine'",
      );
    });

    it("combines all options", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerRun({
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

      await expect(dockerRun({ image: "alpine" })).rejects.toThrow(
        "docker command failed",
      );
    });

    it("trims trailing newline from container ID", async () => {
      execMock.mockImplementation(execSuccess("abc123def\n\n"));

      const id = await dockerRun({ image: "alpine" });

      expect(id).toBe("abc123def");
    });
  });

  // ── stop ──────────────────────────────────────────────────────────

  describe("stop", () => {
    it("runs docker stop with the container name", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerStop("sonar-server");

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe("docker stop 'sonar-server'");
    });

    it("rejects when docker stop fails", async () => {
      execMock.mockImplementation(execFailure("no such container"));

      await expect(dockerStop("nonexistent")).rejects.toThrow(
        "docker command failed",
      );
    });
  });

  // ── rm ────────────────────────────────────────────────────────────

  describe("rm", () => {
    it("runs docker rm with the container name", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerRm("sonar-server");

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe("docker rm 'sonar-server'");
    });

    it("rejects when docker rm fails", async () => {
      execMock.mockImplementation(execFailure("conflict"));

      await expect(dockerRm("running-container")).rejects.toThrow(
        "docker command failed",
      );
    });
  });

  // ── argument escaping ─────────────────────────────────────────────

  describe("argument escaping", () => {
    it("escapes single quotes in image names", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerPull("img'with'quotes");

      // shell-escaping: 'img'\''with'\''quotes'
      expect(execMock.mock.calls[0][0]).toBe(
        "docker pull 'img'\\''with'\\''quotes'",
      );
    });

    it("escapes shell metacharacters in env values", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerRun({
        image: "alpine",
        env: { CMD: "$(malicious)" },
      });

      expect(execMock.mock.calls[0][0]).toContain("'CMD=$(malicious)'");
    });
  });

  // ── networkCreate ─────────────────────────────────────────────────

  describe("networkCreate", () => {
    it("runs docker network create with the name", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerNetworkCreate("scanwise");

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe(
        "docker network create 'scanwise'",
      );
    });

    it("rejects when docker network create fails", async () => {
      execMock.mockImplementation(execFailure("network exists"));

      await expect(dockerNetworkCreate("scanwise")).rejects.toThrow(
        "docker command failed",
      );
    });
  });

  // ── networkRm ────────────────────────────────────────────────────

  describe("networkRm", () => {
    it("runs docker network rm with the name", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerNetworkRm("scanwise");

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe("docker network rm 'scanwise'");
    });

    it("rejects when docker network rm fails", async () => {
      execMock.mockImplementation(execFailure("network not found"));

      await expect(dockerNetworkRm("missing")).rejects.toThrow(
        "docker command failed",
      );
    });
  });

  // ── start ─────────────────────────────────────────────────────────

  describe("start", () => {
    it("runs docker start with the container name", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerStart("sonar-server");

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe("docker start 'sonar-server'");
    });

    it("rejects when docker start fails", async () => {
      execMock.mockImplementation(execFailure("no such container"));

      await expect(dockerStart("nonexistent")).rejects.toThrow(
        "docker command failed",
      );
    });
  });

  // ── exec ──────────────────────────────────────────────────────────

  describe("exec", () => {
    it("runs docker exec with escaped command", async () => {
      execMock.mockImplementation(execSuccess("output line\n"));

      const result = await dockerExec("sonar-server", [
        "grep",
        "SUCCESS",
        "/opt/sonarqube/logs/ce.log",
      ]);

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe(
        "docker exec 'sonar-server' 'grep' 'SUCCESS' '/opt/sonarqube/logs/ce.log'",
      );
      expect(result).toBe("output line");
    });

    it("rejects when docker exec fails", async () => {
      execMock.mockImplementation(execFailure("not running"));

      await expect(dockerExec("stopped", ["echo", "hi"])).rejects.toThrow(
        "docker command failed",
      );
    });
  });

  // ── save ──────────────────────────────────────────────────────────

  describe("save", () => {
    it("runs docker save -o with image and path", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerSave("sonarqube:community", "/tmp/cache/sonarqube.tar");

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe(
        "docker save -o '/tmp/cache/sonarqube.tar' 'sonarqube:community'",
      );
    });

    it("rejects when docker save fails", async () => {
      execMock.mockImplementation(execFailure("permission denied"));

      await expect(dockerSave("img", "/bad/path")).rejects.toThrow(
        "docker command failed",
      );
    });
  });

  // ── load ──────────────────────────────────────────────────────────

  describe("load", () => {
    it("runs docker load -i with input path", async () => {
      execMock.mockImplementation(execSuccess());

      await dockerLoad("/tmp/cache/sonarqube.tar");

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe(
        "docker load -i '/tmp/cache/sonarqube.tar'",
      );
    });

    it("rejects when docker load fails", async () => {
      execMock.mockImplementation(execFailure("file not found"));

      await expect(dockerLoad("/missing.tar")).rejects.toThrow(
        "docker command failed",
      );
    });
  });

  // ── inspect ───────────────────────────────────────────────────────

  describe("inspect", () => {
    it("returns true when container exists", async () => {
      execMock.mockImplementation(
        (_cmd: string, cb: (err: null, stdout: string) => void) =>
          cb(null, "{}"),
      );

      const result = await dockerInspect("sonar-server");

      expect(result).toBe(true);
      expect(execMock.mock.calls[0][0]).toBe("docker inspect 'sonar-server'");
    });

    it("returns false when container does not exist", async () => {
      execMock.mockImplementation((_cmd: string, cb: (err: Error) => void) =>
        cb(new Error("not found")),
      );

      const result = await dockerInspect("nonexistent");

      expect(result).toBe(false);
    });

    it("never throws", async () => {
      execMock.mockImplementation((_cmd: string, cb: (err: Error) => void) =>
        cb(new Error("crash")),
      );

      await expect(dockerInspect("anything")).resolves.toBe(false);
    });
  });

  // ── logs ──────────────────────────────────────────────────────────

  describe("logs", () => {
    it("runs docker logs and returns stdout", async () => {
      execMock.mockImplementation(execSuccess("line1\nline2\n"));

      const result = await dockerLogs("sonar-server");

      expect(execMock).toHaveBeenCalledOnce();
      expect(execMock.mock.calls[0][0]).toBe("docker logs 'sonar-server'");
      expect(result).toBe("line1\nline2");
    });

    it("rejects when docker logs fails", async () => {
      execMock.mockImplementation(execFailure("no such container"));

      await expect(dockerLogs("nonexistent")).rejects.toThrow(
        "docker command failed",
      );
    });
  });
});
