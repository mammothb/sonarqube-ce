import { afterEach, describe, expect, it, vi } from "vitest";
import type { SonarHotspot, SonarIssue, SonarMetrics } from "../src/types.js";

const dockerExecMock = vi.fn();
vi.mock("../src/docker.js", () => ({
  dockerExec: (container: string, cmd: string[]) =>
    dockerExecMock(container, cmd),
}));

import { SonarQube } from "../src/sonarqube.js";

describe("SonarQube", () => {
  afterEach(() => {
    vi.clearAllMocks();
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
      expect(init.body).toContain("password=Son%40rless123"); // @ → %40 // NOSONAR — test credential
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
    function upOnSecondCall() {
      let calls = 0;
      return vi.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ status: "DOWN" }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: "UP" }),
        });
      });
    }

    function upAfterRejection() {
      let calls = 0;
      return vi.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.reject(new Error("ECONNREFUSED"));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: "UP" }),
        });
      });
    }
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
      const fetchMock = upOnSecondCall();
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
      const fetchMock = upAfterRejection();
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
      await sq.createProject("my-project", "my-key");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:9000/api/projects/create");
      expect(init.method).toBe("POST");
      expect(init.body).toContain("name=my-project");
      expect(init.body).toContain("project=my-key");
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from("admin:Son@rless123").toString("base64")}`,
      );
    });

    it("uses name as project key when no key provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      await sq.createProject("my-project");

      const [, init] = fetchMock.mock.calls[0];
      expect(init.body).toContain("name=my-project");
      expect(init.body).toContain("project=my-project");
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
    function qgNoneThenError() {
      let calls = 0;
      return vi.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ projectStatus: { status: "NONE" } }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ projectStatus: { status: "ERROR" } }),
        });
      });
    }
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
      const fetchMock = qgNoneThenError();
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

  // ── searchIssues ──────────────────────────────────────────────────

  describe("searchIssues", () => {
    it("fetches issues with componentKeys and default pagination", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          issues: [
            {
              key: "abc",
              rule: "r1",
              severity: "MAJOR",
              component: "p:file.ts",
              message: "fix",
              type: "BUG",
              creationDate: "2024-01-01",
            },
          ],
          paging: { total: 1 },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      const result = await sq.searchIssues("my-project");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain("/api/issues/search?");
      expect(url).toContain("componentKeys=my-project");
      expect(url).toContain("ps=500");
      expect(url).toContain("p=1");
      expect(result.issues).toHaveLength(1);
      expect(result.paging.total).toBe(1);
    });

    it("includes createdInLast when provided", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [], paging: { total: 0 } }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      await sq.searchIssues("proj", { createdInLast: "30d" });

      expect(fetchMock.mock.calls[0][0]).toContain("createdInLast=30d");
    });

    it("throws on non-OK response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: async () => "Bad request",
        }),
      );

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.searchIssues("proj")).rejects.toThrow(
        "issues/search failed [400]: Bad request",
      );
    });
  });

  // ── fetchAllIssues ────────────────────────────────────────────────

  describe("fetchAllIssues", () => {
    function paginatedIssues(page1: SonarIssue[], page2: SonarIssue[]) {
      let page = 0;
      return vi.fn().mockImplementation(() => {
        page++;
        if (page === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ issues: page1, paging: { total: 750 } }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ issues: page2, paging: { total: 750 } }),
        });
      });
    }
    it("returns all issues from a single page", async () => {
      const issues: SonarIssue[] = [
        {
          key: "a",
          rule: "r1",
          severity: "MAJOR",
          component: "p:f.ts",
          message: "m",
          type: "BUG",
          creationDate: "2024-01-01",
        },
        {
          key: "b",
          rule: "r2",
          severity: "MINOR",
          component: "p:g.ts",
          message: "m",
          type: "CODE_SMELL",
          creationDate: "2024-01-02",
        },
      ];
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ issues, paging: { total: 2 } }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      const result = await sq.fetchAllIssues("proj");

      expect(result).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("paginates across multiple pages", async () => {
      // Page 1: 500 items, total 750 → page 2: 250 items
      const page1 = Array.from({ length: 500 }, (_, i) => ({
        key: `issue-${i}`,
        rule: "r",
        severity: "MINOR" as const,
        component: "p:f.ts",
        message: "m",
        type: "CODE_SMELL" as const,
        creationDate: "2024-01-01",
      }));
      const page2 = Array.from({ length: 250 }, (_, i) => ({
        key: `issue-${500 + i}`,
        rule: "r",
        severity: "MINOR" as const,
        component: "p:f.ts",
        message: "m",
        type: "CODE_SMELL" as const,
        creationDate: "2024-01-01",
      }));

      const fetchMock = paginatedIssues(page1, page2);
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      const result = await sq.fetchAllIssues("proj");

      expect(result).toHaveLength(750);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("handles empty result", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [], paging: { total: 0 } }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      const result = await sq.fetchAllIssues("proj");

      expect(result).toHaveLength(0);
    });

    it("passes createdInLast to searchIssues", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ issues: [], paging: { total: 0 } }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      await sq.fetchAllIssues("proj", { createdInLast: "30d" });

      expect(fetchMock.mock.calls[0][0]).toContain("createdInLast=30d");
    });
  });

  // ── searchHotspots ────────────────────────────────────────────────

  describe("searchHotspots", () => {
    it("fetches hotspots with projectKey and default pagination", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          hotspots: [
            {
              key: "h1",
              component: "p:f.ts",
              message: "risk",
              securityCategory: "xss",
              vulnerabilityProbability: "HIGH",
              ruleKey: "r1",
              creationDate: "2024-01-01",
            },
          ],
          paging: { total: 1 },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      const result = await sq.searchHotspots("my-project");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain("/api/hotspots/search?");
      expect(url).toContain("projectKey=my-project");
      expect(url).toContain("ps=500");
      expect(url).toContain("p=1");
      expect(result.hotspots).toHaveLength(1);
      expect(result.paging.total).toBe(1);
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

      await expect(sq.searchHotspots("missing")).rejects.toThrow(
        "hotspots/search failed [404]: Not found",
      );
    });
  });

  // ── fetchAllHotspots ──────────────────────────────────────────────

  describe("fetchAllHotspots", () => {
    function paginatedHotspots(page1: SonarHotspot[], page2: SonarHotspot[]) {
      let page = 0;
      return vi.fn().mockImplementation(() => {
        page++;
        if (page === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ hotspots: page1, paging: { total: 750 } }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ hotspots: page2, paging: { total: 750 } }),
        });
      });
    }
    it("returns all hotspots from a single page", async () => {
      const hotspots: SonarHotspot[] = [
        {
          key: "h1",
          component: "p:f.ts",
          message: "risk",
          securityCategory: "xss",
          vulnerabilityProbability: "HIGH",
          ruleKey: "r1",
          creationDate: "2024-01-01",
        },
        {
          key: "h2",
          component: "p:g.ts",
          message: "risk",
          securityCategory: "injection",
          vulnerabilityProbability: "MEDIUM",
          ruleKey: "r2",
          creationDate: "2024-01-02",
        },
      ];
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ hotspots, paging: { total: 2 } }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      const result = await sq.fetchAllHotspots("proj");

      expect(result).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("paginates across multiple pages", async () => {
      const mk = (i: number): SonarHotspot => ({
        key: `h-${i}`,
        component: "p:f.ts",
        message: "risk",
        securityCategory: "xss",
        vulnerabilityProbability: "LOW",
        ruleKey: "r",
        creationDate: "2024-01-01",
      });
      const page1 = Array.from({ length: 500 }, (_, i) => mk(i));
      const page2 = Array.from({ length: 250 }, (_, i) => mk(500 + i));

      const fetchMock = paginatedHotspots(page1, page2);
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      const result = await sq.fetchAllHotspots("proj");

      expect(result).toHaveLength(750);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("handles empty result", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ hotspots: [], paging: { total: 0 } }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      const result = await sq.fetchAllHotspots("proj");

      expect(result).toHaveLength(0);
    });
  });

  // ── reindexIssues ─────────────────────────────────────────────────

  describe("reindexIssues", () => {
    it("sends POST to issues/reindex with project", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      await sq.reindexIssues("my-project");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "http://localhost:9000/api/issues/reindex?project=my-project",
      );
      expect(init.method).toBe("POST");
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

      await expect(sq.reindexIssues("missing")).rejects.toThrow(
        "issues/reindex failed [404]: Project not found",
      );
    });
  });

  // ── waitForReindex ───────────────────────────────────────────────

  describe("waitForReindex", () => {
    function grepFailsThenSucceeds() {
      let calls = 0;
      return () => {
        calls++;
        if (calls === 1) {
          return Promise.reject(new Error("no match"));
        }
        return Promise.resolve("");
      };
    }
    it("resolves when grep finds SUCCESS immediately", async () => {
      dockerExecMock.mockResolvedValue(""); // grep -q found match

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(
        sq.waitForReindex("sonar-server", 10),
      ).resolves.toBeUndefined();

      expect(dockerExecMock).toHaveBeenCalledOnce();
      expect(dockerExecMock.mock.calls[0]).toEqual([
        "sonar-server",
        ["grep", "-q", "ISSUE_SYNC.*SUCCESS", "/opt/sonarqube/logs/ce.log"],
      ]);
    });

    it("retries when grep fails (no match)", async () => {
      dockerExecMock.mockImplementation(grepFailsThenSucceeds());

      vi.stubGlobal("setTimeout", (fn: () => void) => fn());

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await sq.waitForReindex("sonar-server", 10);

      expect(dockerExecMock).toHaveBeenCalledTimes(2);
    });

    it("throws after timeout when grep never succeeds", async () => {
      dockerExecMock.mockRejectedValue(new Error("no match"));
      vi.stubGlobal("setTimeout", (fn: () => void) => fn());

      const nowStub = vi.fn().mockReturnValueOnce(0).mockReturnValue(20000);
      vi.stubGlobal("Date", { ...Date, now: nowStub });

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.waitForReindex("sonar-server", 10)).rejects.toThrow(
        "Reindex did not complete within 10s",
      );
    });
  });

  // ── retry on 5xx ────────────────────────────────────────────────

  describe("5xx retry", () => {
    function busyThenUp() {
      let calls = 0;
      return vi.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({
            ok: false,
            status: 503,
            text: async () => "busy",
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: "UP" }),
        });
      });
    }
    it("retries on 503 and succeeds on second attempt", async () => {
      const fetchMock = busyThenUp();
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("setTimeout", (fn: () => void) => fn());

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });
      const result = await sq.systemStatus();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ status: "UP" });
    });

    it("gives up after 3 attempts and returns the 503 response", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => "still busy",
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("setTimeout", (fn: () => void) => fn());

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.systemStatus()).rejects.toThrow(
        "system/status failed [503]",
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("does not retry on 4xx errors", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });
      vi.stubGlobal("fetch", fetchMock);

      const sq = new SonarQube("http://localhost:9000", {
        user: "admin",
        pass: "admin",
      });

      await expect(sq.systemStatus()).rejects.toThrow(
        "system/status failed [401]",
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });
});
