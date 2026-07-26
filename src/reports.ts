import type { SonarIssue } from "./types.js";

/** Escape markdown table-breaking characters in a string */
function escapeMd(value: string): string {
  return value
    .replace(/\|/g, "\\|")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>");
}

/** One-line severity badge */
function severityBadge(severity: string): string {
  switch (severity) {
    case "BLOCKER":
      return "🔴 BLOCKER";
    case "CRITICAL":
      return "🟠 CRITICAL";
    case "MAJOR":
      return "🟡 MAJOR";
    case "MINOR":
      return "🟢 MINOR";
    case "INFO":
      return "ℹ️ INFO";
    default:
      return severity;
  }
}

/** Type label */
function typeLabel(type: string): string {
  switch (type) {
    case "BUG":
      return "🐛 BUG";
    case "VULNERABILITY":
      return "🛡️ VULNERABILITY";
    case "CODE_SMELL":
      return "👃 CODE_SMELL";
    default:
      return type;
  }
}

/** Extract file path from component key ("projectKey:path/to/file.ts") */
function filePath(component: string): string {
  const idx = component.indexOf(":");
  return idx !== -1 ? component.slice(idx + 1) : component;
}

/**
 * Full issues report as a markdown table.
 * Returns "No issues found." when the array is empty.
 */
export function generateIssuesReportMd(
  issues: SonarIssue[],
  projectName: string,
): string {
  if (issues.length === 0) {
    return `# Issues Report — ${escapeMd(projectName)}\n\nNo issues found.`;
  }

  const lines: string[] = [
    `# Issues Report — ${escapeMd(projectName)}`,
    "",
    "| Severity | Type | Rule | Message | Component | Line | Author | Effort |",
    "|----------|------|------|---------|-----------|------|--------|--------|",
  ];

  for (const issue of issues) {
    lines.push(
      `| ${severityBadge(issue.severity)} | ${typeLabel(issue.type)} | ${escapeMd(issue.rule)} | ${escapeMd(issue.message)} | ${escapeMd(filePath(issue.component))} | ${issue.line ?? "-"} | ${escapeMd(issue.author ?? "-")} | ${escapeMd(issue.effort ?? "-")} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Compact inline issues table for embedding in step summaries.
 * Returns empty string when the array is empty.
 */
export function generateIssuesSummaryMd(issues: SonarIssue[]): string {
  if (issues.length === 0) {
    return "";
  }

  const lines: string[] = [
    `#### Issues (${issues.length})`,
    "",
    "| Severity | Type | File | Message |",
    "|----------|------|------|---------|",
  ];

  for (const issue of issues) {
    lines.push(
      `| ${severityBadge(issue.severity)} | ${typeLabel(issue.type)} | ${escapeMd(filePath(issue.component))} | ${escapeMd(issue.message)} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}
