import type { SonarHotspot, SonarIssue, SonarMetrics } from "./types.js";

/**
 * Convert a SonarQube rating (1 = best, 5 = worst) to star display.
 * 1 → ★★★★★, 5 → ★☆☆☆☆
 */
export function generateStars(rating: number): string {
  const rounded = Math.round(rating);
  return "★".repeat(6 - rounded) + "☆".repeat(rounded - 1);
}

interface AnalysisSummaryParams {
  metrics: SonarMetrics;
  newIssues: SonarIssue[];
  newHotspots: SonarHotspot[];
  newArtifactUrl?: string;
  overallArtifactUrl?: string;
}

/** Build a lookup from metric key to value */
function metricMap(metrics: SonarMetrics): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of metrics.component.measures) {
    map[m.metric] = m.value;
  }
  return map;
}

/** Format a number value (round to 1 decimal if float) */
function fmt(val: string): string {
  const n = Number(val);
  if (Number.isNaN(n)) {
    return val;
  }
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Format a rating value to stars, or "-" if missing */
function ratingStars(m: Record<string, string>, key: string): string {
  const val = m[key];
  if (val === undefined || val === "") {
    return "-";
  }
  return generateStars(Number(val));
}

/**
 * Build the full analysis summary markdown string.
 * Includes quality gate banner, new-code stats, overall metrics,
 * collapsible issues/hotspots, and artifact download links.
 */
export function generateAnalysisSummary(params: AnalysisSummaryParams): string {
  const {
    metrics,
    newIssues,
    newHotspots,
    newArtifactUrl,
    overallArtifactUrl,
  } = params;
  const m = metricMap(metrics);
  const lines: string[] = [];

  // ── Quality gate banner ───────────────────────────────────────────
  const qgStatus = m.alert_status ?? "NONE";
  if (qgStatus === "OK") {
    lines.push(
      "## ✅ Quality Gate Passed",
      "",
      "All quality gate conditions are met.",
      "",
    );
  } else if (qgStatus === "ERROR") {
    lines.push(
      "## ❌ Quality Gate Failed",
      "",
      "One or more quality gate conditions failed.",
      "",
    );
  } else {
    lines.push(
      "## ⏳ Quality Gate — No Data",
      "",
      "No quality gate has been computed for this project yet.",
      "",
    );
  }

  // ── New-code stats ───────────────────────────────────────────────
  if (newIssues.length > 0 || newHotspots.length > 0) {
    lines.push("### New Code", "");
    lines.push("| Metric | Value |", "|--------|-------|");
    if (newIssues.length > 0) {
      lines.push(`| New Issues | ${newIssues.length} |`);
    }
    if (newHotspots.length > 0) {
      lines.push(`| New Hotspots | ${newHotspots.length} |`);
    }
    lines.push("");
  }

  // ── Overall metrics ──────────────────────────────────────────────
  lines.push("### Overall Metrics", "");
  lines.push("| Metric | Value | Rating |", "|--------|-------|--------|");

  const metricsTable: Array<{ label: string; value: string; stars: string }> = [
    {
      label: "Bugs",
      value: fmt(m.bugs ?? "0"),
      stars: ratingStars(m, "reliability_rating"),
    },
    {
      label: "Vulnerabilities",
      value: fmt(m.vulnerabilities ?? "0"),
      stars: ratingStars(m, "security_rating"),
    },
    {
      label: "Code Smells",
      value: fmt(m.code_smells ?? "0"),
      stars: ratingStars(m, "sqale_rating"),
    },
    {
      label: "Coverage",
      value: m.coverage ? `${fmt(m.coverage)}%` : "-",
      stars: "-",
    },
    {
      label: "Duplications",
      value: m.duplicated_lines_density
        ? `${fmt(m.duplicated_lines_density)}%`
        : "-",
      stars: "-",
    },
    { label: "Lines of Code", value: fmt(m.ncloc ?? "0"), stars: "-" },
  ];

  for (const row of metricsTable) {
    if (row.value !== "-" || row.stars !== "-") {
      lines.push(`| ${row.label} | ${row.value} | ${row.stars} |`);
    }
  }
  lines.push("");

  // ── Artifact links ───────────────────────────────────────────────
  if (newArtifactUrl || overallArtifactUrl) {
    lines.push("### Downloads", "");
    if (newArtifactUrl) {
      lines.push(`- [New Code Report](${newArtifactUrl})`);
    }
    if (overallArtifactUrl) {
      lines.push(`- [Overall Report](${overallArtifactUrl})`);
    }
    lines.push("");
  }

  // ── Collapsible new issues ───────────────────────────────────────
  if (newIssues.length > 0) {
    lines.push("<details>");
    lines.push(`<summary><b>New Issues (${newIssues.length})</b></summary>`);
    lines.push("");
    lines.push("| Severity | Type | File | Message |");
    lines.push("|----------|------|------|---------|");
    for (const issue of newIssues) {
      const file = issue.component.includes(":")
        ? issue.component.slice(issue.component.indexOf(":") + 1)
        : issue.component;
      lines.push(
        `| ${issue.severity} | ${issue.type} | ${file} | ${issue.message} |`,
      );
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  // ── Collapsible new hotspots ─────────────────────────────────────
  if (newHotspots.length > 0) {
    lines.push("<details>");
    lines.push(
      `<summary><b>New Security Hotspots (${newHotspots.length})</b></summary>`,
    );
    lines.push("");
    lines.push("| Probability | Category | File | Message |");
    lines.push("|-------------|----------|------|---------|");
    for (const h of newHotspots) {
      const file = h.component.includes(":")
        ? h.component.slice(h.component.indexOf(":") + 1)
        : h.component;
      lines.push(
        `| ${h.vulnerabilityProbability} | ${h.securityCategory} | ${file} | ${h.message} |`,
      );
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  return lines.join("\n");
}
