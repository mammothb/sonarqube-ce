import type { SonarHotspot, SonarIssue, SonarMetrics } from "./types.js";

/** Escape markdown table-breaking characters */
function escapeMd(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`");
}

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

/** Build the quality gate banner section */
function qgBanner(alertStatus: string): string[] {
  if (alertStatus === "OK") {
    return [
      "## ✅ Quality Gate Passed",
      "",
      "All quality gate conditions are met.",
      "",
    ];
  }
  if (alertStatus === "ERROR") {
    return [
      "## ❌ Quality Gate Failed",
      "",
      "One or more quality gate conditions failed.",
      "",
    ];
  }
  return [
    "## ⏳ Quality Gate — No Data",
    "",
    "No quality gate has been computed for this project yet.",
    "",
  ];
}

/** Build the overall metrics table rows */
function metricsTableRows(m: Record<string, string>): string[] {
  const rows: string[] = [
    "### Overall Metrics",
    "",
    "| Metric | Value | Rating |",
    "|--------|-------|--------|",
  ];

  const entries: Array<{ label: string; value: string; stars: string }> = [
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

  for (const row of entries) {
    if (row.value !== "-" || row.stars !== "-") {
      rows.push(`| ${row.label} | ${row.value} | ${row.stars} |`);
    }
  }
  rows.push("");
  return rows;
}

/** Build artifact download links section */
function artifactLinks(newUrl?: string, overallUrl?: string): string[] {
  if (!newUrl && !overallUrl) {
    return [];
  }
  const lines = ["### Downloads", ""];
  if (newUrl) {
    lines.push(`- [New Code Report](${newUrl})`);
  }
  if (overallUrl) {
    lines.push(`- [Overall Report](${overallUrl})`);
  }
  lines.push("");
  return lines;
}

/** Build collapsible HTML section for a list of items */
function collapsibleSection(
  summary: string,
  headers: string[],
  rows: string[][],
): string[] {
  const lines: string[] = [
    "<details>",
    `<summary><b>${summary}</b></summary>`,
    "",
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "------").join("|")}|`,
  ];
  for (const row of rows) {
    lines.push(`| ${row.join(" | ")} |`);
  }
  lines.push("", "</details>", "");
  return lines;
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

  lines.push(...qgBanner(m.alert_status ?? "NONE"));

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

  lines.push(...metricsTableRows(m));
  lines.push(...artifactLinks(newArtifactUrl, overallArtifactUrl));

  // ── Collapsible new issues ───────────────────────────────────────
  if (newIssues.length > 0) {
    const rows = newIssues.map((issue) => {
      const file = issue.component.includes(":")
        ? issue.component.slice(issue.component.indexOf(":") + 1)
        : issue.component;
      return [
        issue.severity,
        issue.type,
        file,
        String(issue.line ?? "-"),
        escapeMd(issue.message),
      ];
    });
    lines.push(
      ...collapsibleSection(
        `New Issues (${newIssues.length})`,
        ["Severity", "Type", "File", "Line", "Message"],
        rows,
      ),
    );
  }

  // ── Collapsible new hotspots ─────────────────────────────────────
  if (newHotspots.length > 0) {
    const rows = newHotspots.map((h) => {
      const file = h.component.includes(":")
        ? h.component.slice(h.component.indexOf(":") + 1)
        : h.component;
      return [
        h.vulnerabilityProbability,
        h.securityCategory,
        file,
        String(h.line ?? "-"),
        escapeMd(h.message),
      ];
    });
    lines.push(
      ...collapsibleSection(
        `New Security Hotspots (${newHotspots.length})`,
        ["Probability", "Category", "File", "Line", "Message"],
        rows,
      ),
    );
  }

  return lines.join("\n");
}
