import { describe, expect, it } from "vitest";
import {
  generateIssuesReportMd,
  generateIssuesSummaryMd,
} from "../src/reports.js";
import type { SonarIssue } from "../src/types.js";

/** Minimal valid issue factory */
function issue(overrides: Partial<SonarIssue> = {}): SonarIssue {
  return {
    key: "abc123",
    rule: "javascript:S1234",
    severity: "MAJOR",
    component: "my-project:src/file.ts",
    message: "Avoid using console.log",
    type: "CODE_SMELL",
    creationDate: "2024-01-15T10:30:00+0000",
    line: 42,
    author: "dev@example.com",
    effort: "5min",
    ...overrides,
  };
}

describe("generateIssuesReportMd", () => {
  it("returns heading + 'No issues found' for empty array", () => {
    const md = generateIssuesReportMd([], "My Project");
    expect(md).toContain("# Issues Report — My Project");
    expect(md).toContain("No issues found.");
    expect(md).not.toContain("|");
  });

  it("renders a single issue in a markdown table", () => {
    const md = generateIssuesReportMd(
      [issue({ message: "Fix this" })],
      "My Project",
    );

    expect(md).toContain("# Issues Report — My Project");
    expect(md).toContain("| Severity | Type | Rule | Message |");
    expect(md).toContain(
      "| 🟡 MAJOR | 👃 CODE_SMELL | javascript:S1234 | Fix this | src/file.ts | 42 | dev@example.com | 5min |",
    );
  });

  it("renders multiple issues", () => {
    const md = generateIssuesReportMd(
      [
        issue({ key: "a", severity: "BLOCKER", message: "Critical bug" }),
        issue({ key: "b", severity: "INFO", message: "Style nit" }),
      ],
      "Proj",
    );

    expect(md).toContain("🔴 BLOCKER");
    expect(md).toContain("ℹ️ INFO");
    const tableRows = md.split("\n").filter((l) => l.startsWith("|"));
    // header + separator + 2 data rows
    expect(tableRows).toHaveLength(4);
  });

  it("uses '-' for missing optional fields", () => {
    const md = generateIssuesReportMd(
      [
        issue({
          line: undefined,
          author: undefined,
          effort: undefined,
          message: "No meta",
        }),
      ],
      "P",
    );

    // line, author, effort columns should show "-"
    expect(md).toContain("| No meta | src/file.ts | - | - | - |");
  });

  it("escapes markdown special characters in message", () => {
    const md = generateIssuesReportMd(
      [issue({ message: "use | pipe * bold _ italic ` code [link] <tag>" })],
      "P",
    );

    expect(md).toContain("\\|");
    expect(md).toContain("\\*");
    expect(md).toContain("\\_");
    expect(md).toContain("\\`");
    expect(md).toContain("\\[");
    expect(md).toContain("\\]");
    expect(md).toContain("\\<");
    expect(md).toContain("\\>");
  });

  it("escapes markdown special characters in project name", () => {
    const md = generateIssuesReportMd([], "a | b * c");
    expect(md).toContain("a \\| b \\* c");
  });

  it("extracts file path from component key", () => {
    const md = generateIssuesReportMd(
      [issue({ component: "proj:deep/nested/file.ts" })],
      "P",
    );
    expect(md).toContain("deep/nested/file.ts");
  });

  it("handles component without colon (unusual)", () => {
    const md = generateIssuesReportMd([issue({ component: "no-colon" })], "P");
    expect(md).toContain("no-colon");
  });

  it("uses raw severity string for unknown severities", () => {
    const md = generateIssuesReportMd(
      [issue({ severity: "UNKNOWN" as SonarIssue["severity"] })],
      "P",
    );
    expect(md).toContain("UNKNOWN");
  });
});

describe("generateIssuesSummaryMd", () => {
  it("returns empty string for empty array", () => {
    expect(generateIssuesSummaryMd([])).toBe("");
  });

  it("renders a compact table with heading showing count", () => {
    const md = generateIssuesSummaryMd([issue({ message: "Fix this" })]);

    expect(md).toContain("#### Issues (1)");
    expect(md).toContain("| Severity | Type | File | Message |");
    expect(md).toContain(
      "| 🟡 MAJOR | 👃 CODE_SMELL | src/file.ts | Fix this |",
    );
  });

  it("renders multiple issues", () => {
    const md = generateIssuesSummaryMd([
      issue({ key: "a", severity: "CRITICAL" }),
      issue({ key: "b", severity: "MINOR" }),
    ]);

    expect(md).toContain("#### Issues (2)");
    const rows = md.split("\n").filter((l) => l.startsWith("|"));
    // header + separator + 2 data rows
    expect(rows).toHaveLength(4);
  });

  it("escapes markdown in messages", () => {
    const md = generateIssuesSummaryMd([issue({ message: "pipe | star *" })]);

    expect(md).toContain("pipe \\| star \\*");
  });
});
