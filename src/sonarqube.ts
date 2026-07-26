import type { SonarQubeAuth } from "./types.js";

/** Base64-encode credentials for Basic Auth header */
function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
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
    const resp = await fetch(`${this.baseUrl}/api/system/status`, {
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
    const resp = await fetch(`${this.baseUrl}/api/users/change_password`, {
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
    });
    if (!resp.ok) {
      throw new Error(
        `change_password failed [${resp.status}]: ${await resp.text()}`,
      );
    }
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
