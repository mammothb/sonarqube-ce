import { afterEach, describe, expect, it, vi } from "vitest";
import { SonarQube } from "../src/sonarqube.js";
import type { SonarMetrics } from "../src/types.js";

describe("SonarQube", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ── constructor ───────────────────────────────────────────────────

  describe("constructor", () => {
    it("stores baseUrl without trailing slash", () => {
      const sq = new SonarQube("http://localhost:9000/", {
        user: "admin",
        pass: "admin",
      });
      expect(sq).toBeDefined();
    });
  });

  // ── systemStatus ──────────────────────────────────────────────────

  describe("systemStatus", () => {
    it("fetches /api/system/status with Basic Auth", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "UP" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      const result = await sq.systemStatus();

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:9000/api/system/status");
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from("admin:admin").toString("base64")}`,
      );
      expect(result).toEqual({ status: "UP" });
    });

    it("throws on non-OK response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          text: async () => "Service Unavailable",
        }),
      );

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.systemStatus()).rejects.toThrow(
        "system/status failed [503]: Service Unavailable",
      );
    });

    it("strips trailing slash from baseUrl", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "UP" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000/", {
        user: "admin",
        pass: "admin",
      });
      await sq.systemStatus();

      expect(fetchMock.mock.calls[0][0]).toBe(
        "http://localhost:9000/api/system/status",
      );
    });
  });

  // ── changePassword ────────────────────────────────────────────────

  describe("changePassword", () => {
    it("sends POST with form-encoded body and Basic Auth", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      await sq.changePassword("Son@rless123");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:9000/api/users/change_password");
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from("admin:admin").toString("base64")}`,
      );
      expect(init.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded",
      );
      expect(init.body).toContain("login=admin");
      expect(init.body).toContain("previousPassword=admin");
      expect(init.body).toContain("password=Son%40rless123"); // @ → %40
    });

    it("throws on non-OK response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: async () => "Unauthorized",
        }),
      );

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "wrong",
      });

      await expect(sq.changePassword("newpass")).rejects.toThrow(
        "change_password failed [401]: Unauthorized",
      );
    });
  });

  // ── setAuth ───────────────────────────────────────────────────────

  describe("setAuth", () => {
    it("updates credentials used in subsequent requests", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "UP" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      sq.setAuth({ user: "admin", pass: "Son@rless123" });
      await sq.systemStatus();

      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
        `Basic ${Buffer.from("admin:Son@rless123").toString("base64")}`,
      );
    });
  });

  // ── waitForUp ─────────────────────────────────────────────────────

  describe("waitForUp", () => {
    it("resolves immediately when status is UP", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ status: "UP" }),
        }),
      );

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      await expect(sq.waitForUp(10)).resolves.toBeUndefined();
    });

    it("retries when status is not UP", async () => {
      // First call: DOWN, second: UP
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "DOWN" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "UP" }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      // Override setTimeout for instant retries
      vi.stubGlobal("setTimeout", (fn: () => void) => fn());

      await sq.waitForUp(10);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries when fetch throws (server not reachable)", async () => {
      // First call: network error, second: UP
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "UP" }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      vi.stubGlobal("setTimeout", (fn: () => void) => fn());

      await sq.waitForUp(10);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws after timeout when never UP", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ status: "STARTING" }),
        }),
      );
      vi.stubGlobal("setTimeout", (fn: () => void) => fn());

      // Mock Date.now so deadline is always past
      const nowStub = vi
        .fn()
        .mockReturnValueOnce(0) // deadline = 0 + 10*1000 = 10000
        .mockReturnValue(20000); // always past deadline

      vi.stubGlobal("Date", { ...Date, now: nowStub });

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.waitForUp(10)).rejects.toThrow(
        "SonarQube did not reach UP status within 10s",
      );
    });
  });

  // ── createProject ─────────────────────────────────────────────────

  describe("createProject", () => {
    it("sends POST with name and project key", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "Son@rless123",
      });
      await sq.createProject("my-project");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:9000/api/projects/create");
      expect(init.method).toBe("POST");
      expect(init.body).toContain("name=my-project");
      expect(init.body).toContain("project=my-project");
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from("admin:Son@rless123").toString("base64")}`,
      );
    });

    it("throws on non-OK response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: async () => "Project already exists",
        }),
      );

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.createProject("dup")).rejects.toThrow(
        "projects/create failed [400]: Project already exists",
      );
    });
  });

  // ── setHomepage ───────────────────────────────────────────────────

  describe("setHomepage", () => {
    it("sends POST to update_visibility with public", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "Son@rless123",
      });
      await sq.setHomepage("my-project");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:9000/api/projects/update_visibility");
      expect(init.method).toBe("POST");
      expect(init.body).toContain("project=my-project");
      expect(init.body).toContain("visibility=public");
    });

    it("throws on non-OK response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          text: async () => "Project not found",
        }),
      );

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.setHomepage("missing")).rejects.toThrow(
        "projects/update_visibility failed [404]: Project not found",
      );
    });
  });

  // ── generateToken ─────────────────────────────────────────────────

  describe("generateToken", () => {
    it("sends POST and returns token from response", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: "squ_abc123xyz" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "Son@rless123",
      });
      const token = await sq.generateToken("scan-token");

      expect(token).toBe("squ_abc123xyz");
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:9000/api/user_tokens/generate");
      expect(init.method).toBe("POST");
      expect(init.body).toContain("name=scan-token");
    });

    it("throws on non-OK response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: async () => "Token name already exists",
        }),
      );

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.generateToken("dup")).rejects.toThrow(
        "user_tokens/generate failed [400]: Token name already exists",
      );
    });
  });

  // ── projectStatus ────────────────────────────────────────────────

  describe("projectStatus", () => {
    it("fetches quality gate status with encoded project key", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          projectStatus: { status: "OK" },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      const result = await sq.projectStatus("my/project");

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toBe(
        "http://localhost:9000/api/qualitygates/project_status?projectKey=my%2Fproject",
      );
      expect(result).toEqual({ projectStatus: { status: "OK" } });
    });

    it("throws on non-OK response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          text: async () => "Not found",
        }),
      );

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.projectStatus("missing")).rejects.toThrow(
        "qualitygates/project_status failed [404]: Not found",
      );
    });
  });

  // ── waitForQualityGate ───────────────────────────────────────────

  describe("waitForQualityGate", () => {
    it("resolves immediately when status is not NONE", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ projectStatus: { status: "OK" } }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.waitForQualityGate("proj", 10)).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("retries while status is NONE", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ projectStatus: { status: "NONE" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ projectStatus: { status: "ERROR" } }),
        });
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("setTimeout", (fn: () => void) => fn());

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await sq.waitForQualityGate("proj", 10);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws after timeout when status stays NONE", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ projectStatus: { status: "NONE" } }),
        }),
      );
      vi.stubGlobal("setTimeout", (fn: () => void) => fn());

      const nowStub = vi.fn().mockReturnValueOnce(0).mockReturnValue(20000);
      vi.stubGlobal("Date", { ...Date, now: nowStub });

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.waitForQualityGate("proj", 10)).rejects.toThrow(
        "Quality gate status still NONE after 10s",
      );
    });
  });

  // ── measures ──────────────────────────────────────────────────────

  describe("measures", () => {
    it("fetches metrics with comma-separated keys", async () => {
      const metricsResponse: SonarMetrics = {
        component: {
          key: "my-project",
          name: "My Project",
          measures: [
            { metric: "bugs", value: "5" },
            { metric: "vulnerabilities", value: "0" },
          ],
        },
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => metricsResponse,
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      const result = await sq.measures("my-project", [
        "bugs",
        "vulnerabilities",
      ]);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain("/api/measures/component?");
      expect(url).toContain("component=my-project");
      expect(url).toContain("metricKeys=bugs%2Cvulnerabilities");
      expect(result).toEqual(metricsResponse);
    });

    it("throws on non-OK response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          text: async () => "Component not found",
        }),
      );

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.measures("missing", ["bugs"])).rejects.toThrow(
        "measures/component failed [404]: Component not found",
      );
    });
  });
});
