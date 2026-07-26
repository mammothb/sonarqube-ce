import { describe, expect, it } from "vitest";
import { generateAnalysisSummary, generateStars } from "../src/summary.js";
import type { SonarHotspot, SonarIssue, SonarMetrics } from "../src/types.js";

/** Minimal valid metrics factory */
function metrics(
  measures: Array<{ metric: string; value: string }> = [],
): SonarMetrics {
  return {
    component: {
      key: "my-project",
      name: "My Project",
      measures,
    },
  };
}

/** Minimal issue factory */
function issue(overrides: Partial<SonarIssue> = {}): SonarIssue {
  return {
    key: "abc",
    rule: "r1",
    severity: "MAJOR",
    component: "proj:src/f.ts",
    message: "msg",
    type: "CODE_SMELL",
    creationDate: "2024-01-01",
    ...overrides,
  };
}

/** Minimal hotspot factory */
function hotspot(overrides: Partial<SonarHotspot> = {}): SonarHotspot {
  return {
    key: "h1",
    component: "proj:src/f.ts",
    message: "risk",
    securityCategory: "xss",
    vulnerabilityProbability: "HIGH",
    ruleKey: "r1",
    creationDate: "2024-01-01",
    ...overrides,
  };
}

// ── generateStars ───────────────────────────────────────────────────

describe("generateStars", () => {
  it("rating 1 → ★★★★★", () => {
    expect(generateStars(1)).toBe("★★★★★");
  });

  it("rating 2 → ★★★★☆", () => {
    expect(generateStars(2)).toBe("★★★★☆");
  });

  it("rating 3 → ★★★☆☆", () => {
    expect(generateStars(3)).toBe("★★★☆☆");
  });

  it("rating 5 → ★☆☆☆☆", () => {
    expect(generateStars(5)).toBe("★☆☆☆☆");
  });

  it("rounds fractional ratings", () => {
    expect(generateStars(1.4)).toBe("★★★★★"); // rounds to 1
    expect(generateStars(2.6)).toBe("★★★☆☆"); // rounds to 3
  });
});

// ── generateAnalysisSummary ─────────────────────────────────────────

describe("generateAnalysisSummary", () => {
  it("shows OK banner when alert_status is OK", () => {
    const md = generateAnalysisSummary({
      metrics: metrics([{ metric: "alert_status", value: "OK" }]),
      newIssues: [],
      newHotspots: [],
    });

    expect(md).toContain("✅ Quality Gate Passed");
  });

  it("shows ERROR banner when alert_status is ERROR", () => {
    const md = generateAnalysisSummary({
      metrics: metrics([{ metric: "alert_status", value: "ERROR" }]),
      newIssues: [],
      newHotspots: [],
    });

    expect(md).toContain("❌ Quality Gate Failed");
  });

  it("shows No Data banner when alert_status is missing", () => {
    const md = generateAnalysisSummary({
      metrics: metrics([]),
      newIssues: [],
      newHotspots: [],
    });

    expect(md).toContain("⏳ Quality Gate — No Data");
  });

  it("includes overall metrics table with star ratings", () => {
    const md = generateAnalysisSummary({
      metrics: metrics([
        { metric: "bugs", value: "12" },
        { metric: "vulnerabilities", value: "3" },
        { metric: "code_smells", value: "45" },
        { metric: "reliability_rating", value: "1" },
        { metric: "security_rating", value: "2" },
        { metric: "sqale_rating", value: "3" },
        { metric: "coverage", value: "78.5" },
        { metric: "duplicated_lines_density", value: "3.2" },
        { metric: "ncloc", value: "15000" },
      ]),
      newIssues: [],
      newHotspots: [],
    });

    expect(md).toContain("### Overall Metrics");
    expect(md).toContain("| Bugs | 12 | ★★★★★ |");
    expect(md).toContain("| Vulnerabilities | 3 | ★★★★☆ |");
    expect(md).toContain("| Code Smells | 45 | ★★★☆☆ |");
    expect(md).toContain("| Coverage | 78.5% |");
    expect(md).toContain("| Duplications | 3.2% |");
    expect(md).toContain("| Lines of Code | 15000 |");
  });

  it("shows new-code stats when new issues/hotspots present", () => {
    const md = generateAnalysisSummary({
      metrics: metrics([]),
      newIssues: [issue(), issue()],
      newHotspots: [hotspot()],
    });

    expect(md).toContain("### New Code");
    expect(md).toContain("| New Issues | 2 |");
    expect(md).toContain("| New Hotspots | 1 |");
  });

  it("omits new-code section when nothing new", () => {
    const md = generateAnalysisSummary({
      metrics: metrics([]),
      newIssues: [],
      newHotspots: [],
    });

    expect(md).not.toContain("### New Code");
  });

  it("includes artifact download links when URLs provided", () => {
    const md = generateAnalysisSummary({
      metrics: metrics([]),
      newIssues: [],
      newHotspots: [],
      newArtifactUrl: "https://example.com/new",
      overallArtifactUrl: "https://example.com/overall",
    });

    expect(md).toContain("### Downloads");
    expect(md).toContain("[New Code Report](https://example.com/new)");
    expect(md).toContain("[Overall Report](https://example.com/overall)");
  });

  it("omits downloads section when no URLs", () => {
    const md = generateAnalysisSummary({
      metrics: metrics([]),
      newIssues: [],
      newHotspots: [],
    });

    expect(md).not.toContain("### Downloads");
  });

  it("includes collapsible new issues section", () => {
    const md = generateAnalysisSummary({
      metrics: metrics([]),
      newIssues: [
        issue({
          severity: "BLOCKER",
          message: "Critical",
          component: "proj:a.ts",
        }),
        issue({ severity: "MINOR", message: "Minor", component: "proj:b.ts" }),
      ],
      newHotspots: [],
    });

    expect(md).toContain("<details>");
    expect(md).toContain("<summary><b>New Issues (2)</b></summary>");
    expect(md).toContain("| BLOCKER | CODE_SMELL | a.ts | Critical |");
    expect(md).toContain("| MINOR | CODE_SMELL | b.ts | Minor |");
    expect(md).toContain("</details>");
  });

  it("includes collapsible new hotspots section", () => {
    const md = generateAnalysisSummary({
      metrics: metrics([]),
      newIssues: [],
      newHotspots: [
        hotspot({
          vulnerabilityProbability: "MEDIUM",
          message: "Risk",
          component: "proj:x.ts",
        }),
      ],
    });

    expect(md).toContain("<details>");
    expect(md).toContain("<summary><b>New Security Hotspots (1)</b></summary>");
    expect(md).toContain("| MEDIUM | xss | x.ts | Risk |");
    expect(md).toContain("</details>");
  });

  it("formats durations (tech debt) correctly", () => {
    const md = generateAnalysisSummary({
      metrics: metrics([
        { metric: "bugs", value: "1" },
        { metric: "ncloc", value: "100" },
      ]),
      newIssues: [],
      newHotspots: [],
    });

    expect(md).toContain("| Bugs | 1 |");
    expect(md).toContain("| Lines of Code | 100 |");
  });
});
