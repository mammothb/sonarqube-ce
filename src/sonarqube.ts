import { dockerExec } from "./docker.js";
import type {
  SonarHotspot,
  SonarIssue,
  SonarMetrics,
  SonarQubeAuth,
} from "./types.js";

/** Base64-encode credentials for Basic Auth header */
function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

/** Retry fetch on 5xx responses (up to 3 attempts) */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3,
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const resp = await fetch(url, init);
    if (resp.ok || resp.status < 500 || attempt === retries) {
      return resp;
    }
    // 5xx — wait then retry
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  // Unreachable (last iteration returns unconditionally)
  return await fetch(url, init);
}

export class SonarQube {
  private baseUrl: string;
  private auth: SonarQubeAuth;

  constructor(baseUrl: string, auth: SonarQubeAuth) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.auth = auth;
  }

  /** Update credentials (used after password change) */
  setAuth(auth: SonarQubeAuth): void {
    this.auth = auth;
  }

  // ── System ────────────────────────────────────────────────────────

  /** GET /api/system/status */
  async systemStatus(): Promise<{ status: string }> {
    const resp = await fetchWithRetry(`${this.baseUrl}/api/system/status`, {
      headers: { Authorization: basicAuth(this.auth.user, this.auth.pass) },
    });
    if (!resp.ok) {
      throw new Error(
        `system/status failed [${resp.status}]: ${await resp.text()}`,
      );
    }
    return (await resp.json()) as { status: string };
  }

  /** POST /api/users/change_password */
  async changePassword(newPassword: string): Promise<void> {
    const resp = await fetchWithRetry(
      `${this.baseUrl}/api/users/change_password`,
      {
        method: "POST",
        headers: {
          Authorization: basicAuth(this.auth.user, this.auth.pass),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          login: this.auth.user,
          previousPassword: this.auth.pass,
          password: newPassword,
        }).toString(),
      },
    );
    if (!resp.ok) {
      throw new Error(
        `change_password failed [${resp.status}]: ${await resp.text()}`,
      );
    }
  }

  // ── Projects ────────────────────────────────────────────────────

  /** POST /api/projects/create */
  async createProject(name: string): Promise<void> {
    const resp = await fetchWithRetry(`${this.baseUrl}/api/projects/create`, {
      method: "POST",
      headers: {
        Authorization: basicAuth(this.auth.user, this.auth.pass),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ name, project: name }).toString(),
    });
    if (!resp.ok) {
      throw new Error(
        `projects/create failed [${resp.status}]: ${await resp.text()}`,
      );
    }
  }

  /** POST /api/projects/update_visibility (public so homepage works) */
  async setHomepage(project: string): Promise<void> {
    const resp = await fetchWithRetry(
      `${this.baseUrl}/api/projects/update_visibility`,
      {
        method: "POST",
        headers: {
          Authorization: basicAuth(this.auth.user, this.auth.pass),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          project,
          visibility: "public",
        }).toString(),
      },
    );
    if (!resp.ok) {
      throw new Error(
        `projects/update_visibility failed [${resp.status}]: ${await resp.text()}`,
      );
    }
  }

  // ── Tokens ───────────────────────────────────────────────────────

  /** POST /api/user_tokens/generate — returns the token string */
  async generateToken(name: string): Promise<string> {
    const resp = await fetchWithRetry(
      `${this.baseUrl}/api/user_tokens/generate`,
      {
        method: "POST",
        headers: {
          Authorization: basicAuth(this.auth.user, this.auth.pass),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ name }).toString(),
      },
    );
    if (!resp.ok) {
      throw new Error(
        `user_tokens/generate failed [${resp.status}]: ${await resp.text()}`,
      );
    }
    const data = (await resp.json()) as { token: string };
    return data.token;
  }

  // ── Quality Gates ───────────────────────────────────────────────

  /** GET /api/qualitygates/project_status?projectKey=… */
  async projectStatus(
    projectKey: string,
  ): Promise<{ projectStatus: { status: string } }> {
    const url = `${this.baseUrl}/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`;
    const resp = await fetchWithRetry(url, {
      headers: { Authorization: basicAuth(this.auth.user, this.auth.pass) },
    });
    if (!resp.ok) {
      throw new Error(
        `qualitygates/project_status failed [${resp.status}]: ${await resp.text()}`,
      );
    }
    return (await resp.json()) as { projectStatus: { status: string } };
  }

  /** Poll projectStatus until status != "NONE", or throw after timeoutSec */
  async waitForQualityGate(
    projectKey: string,
    timeoutSec: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      const { projectStatus } = await this.projectStatus(projectKey);
      if (projectStatus.status !== "NONE") {
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Quality gate status still NONE after ${timeoutSec}s`);
  }

  // ── Metrics ─────────────────────────────────────────────────────

  /** GET /api/measures/component?component=…&metricKeys=… */
  async measures(
    component: string,
    metricKeys: string[],
  ): Promise<SonarMetrics> {
    const params = new URLSearchParams({
      component,
      metricKeys: metricKeys.join(","),
    });
    const url = `${this.baseUrl}/api/measures/component?${params.toString()}`;
    const resp = await fetchWithRetry(url, {
      headers: { Authorization: basicAuth(this.auth.user, this.auth.pass) },
    });
    if (!resp.ok) {
      throw new Error(
        `measures/component failed [${resp.status}]: ${await resp.text()}`,
      );
    }
    return (await resp.json()) as SonarMetrics;
  }

  // ── Issues ──────────────────────────────────────────────────────

  /** GET /api/issues/search?componentKeys=…&p=…&ps=… */
  async searchIssues(
    componentKeys: string,
    opts?: {
      createdInLast?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<{ issues: SonarIssue[]; paging: { total: number } }> {
    const params = new URLSearchParams({
      componentKeys,
      ps: String(opts?.pageSize ?? 500),
      p: String(opts?.page ?? 1),
    });
    if (opts?.createdInLast) {
      params.set("createdInLast", opts.createdInLast);
    }
    const url = `${this.baseUrl}/api/issues/search?${params.toString()}`;
    const resp = await fetchWithRetry(url, {
      headers: { Authorization: basicAuth(this.auth.user, this.auth.pass) },
    });
    if (!resp.ok) {
      throw new Error(
        `issues/search failed [${resp.status}]: ${await resp.text()}`,
      );
    }
    return (await resp.json()) as {
      issues: SonarIssue[];
      paging: { total: number };
    };
  }

  /** Fetch all issues across pages (pagesize=500) */
  async fetchAllIssues(
    componentKeys: string,
    opts?: { createdInLast?: string },
  ): Promise<SonarIssue[]> {
    const all: SonarIssue[] = [];
    const pageSize = 500;
    let page = 1;
    let total = 0;
    do {
      const result = await this.searchIssues(componentKeys, {
        ...opts,
        page,
        pageSize,
      });
      all.push(...result.issues);
      total = result.paging.total;
      page++;
    } while (all.length < total);
    return all;
  }

  // ── Hotspots ────────────────────────────────────────────────────

  /** GET /api/hotspots/search?projectKey=…&p=…&ps=… */
  async searchHotspots(
    projectKey: string,
    opts?: { page?: number; pageSize?: number },
  ): Promise<{ hotspots: SonarHotspot[]; paging: { total: number } }> {
    const params = new URLSearchParams({
      projectKey,
      ps: String(opts?.pageSize ?? 500),
      p: String(opts?.page ?? 1),
    });
    const url = `${this.baseUrl}/api/hotspots/search?${params.toString()}`;
    const resp = await fetchWithRetry(url, {
      headers: { Authorization: basicAuth(this.auth.user, this.auth.pass) },
    });
    if (!resp.ok) {
      throw new Error(
        `hotspots/search failed [${resp.status}]: ${await resp.text()}`,
      );
    }
    return (await resp.json()) as {
      hotspots: SonarHotspot[];
      paging: { total: number };
    };
  }

  /** Fetch all hotspots across pages (pagesize=500) */
  async fetchAllHotspots(projectKey: string): Promise<SonarHotspot[]> {
    const all: SonarHotspot[] = [];
    const pageSize = 500;
    let page = 1;
    let total = 0;
    do {
      const result = await this.searchHotspots(projectKey, { page, pageSize });
      all.push(...result.hotspots);
      total = result.paging.total;
      page++;
    } while (all.length < total);
    return all;
  }

  // ── Reindex ─────────────────────────────────────────────────────

  /** POST /api/issues/reindex?project=… (triggers async reindex) */
  async reindexIssues(project: string): Promise<void> {
    const url = `${this.baseUrl}/api/issues/reindex?project=${encodeURIComponent(project)}`;
    const resp = await fetchWithRetry(url, {
      method: "POST",
      headers: { Authorization: basicAuth(this.auth.user, this.auth.pass) },
    });
    if (!resp.ok) {
      throw new Error(
        `issues/reindex failed [${resp.status}]: ${await resp.text()}`,
      );
    }
  }

  /**
   * Poll docker exec grep on ce.log until ISSUE_SYNC SUCCESS,
   * or throw after timeoutSec.
   */
  async waitForReindex(
    containerName: string,
    timeoutSec: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      try {
        await dockerExec(containerName, [
          "grep",
          "-q",
          "ISSUE_SYNC.*SUCCESS",
          "/opt/sonarqube/logs/ce.log",
        ]);
        return; // grep -q succeeded (exit 0 = match found)
      } catch {
        // Match not found yet — retry
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Reindex did not complete within ${timeoutSec}s`);
  }

  // ── Wait helpers ───────────────────────────────────────────────────

  /** Poll /api/system/status until UP, or throw after timeoutSec seconds */
  async waitForUp(timeoutSec: number): Promise<void> {
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      try {
        const { status } = await this.systemStatus();
        if (status === "UP") {
          return;
        }
      } catch {
        // Server not reachable yet — retry
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`SonarQube did not reach UP status within ${timeoutSec}s`);
  }
}
