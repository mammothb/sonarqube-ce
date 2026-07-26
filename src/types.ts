/**
 * Shared TypeScript types for the SonarQube CE GitHub Action.
 */

/** A single SonarQube issue from /api/issues/search */
export interface SonarIssue {
  key: string;
  rule: string;
  severity: "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "INFO";
  /** Format: "projectKey:path/to/file.ts" */
  component: string;
  line?: number;
  message: string;
  type: "BUG" | "VULNERABILITY" | "CODE_SMELL";
  author?: string;
  /** e.g. "5min" */
  effort?: string;
  /** ISO 8601 */
  creationDate: string;
}

/** A single SonarQube security hotspot from /api/hotspots/search */
export interface SonarHotspot {
  key: string;
  component: string;
  line?: number;
  message: string;
  securityCategory: string;
  vulnerabilityProbability: "HIGH" | "MEDIUM" | "LOW";
  author?: string;
  ruleKey: string;
  creationDate: string;
}

/** Metrics component from /api/measures/component */
export interface SonarMetrics {
  component: {
    key: string;
    name: string;
    measures: Array<{
      metric: string;
      value: string;
    }>;
  };
}

/** Basic auth credentials for SonarQube REST API */
export interface SonarQubeAuth {
  user: string;
  pass: string;
}

/** Options for Docker.run() */
export interface DockerRunOptions {
  image: string;
  name?: string;
  /** e.g. "9234:9000" */
  port?: string;
  network?: string;
  rm?: boolean;
  env?: Record<string, string>;
  /** e.g. "/host/path:/container/path" */
  volume?: string;
}

/** All action inputs, parsed and validated */
export interface ActionInputs {
  sonarProjectName: string;
  sonarSourcePath: string;
  sonarServerImage: string;
  sonarScannerImage: string;
  sonarOptions: string;
  preScanScript: string;
  githubToken: string;
  generatePrComment: boolean;
  newCodeNDays: string;
  reportsScopes: ("overall" | "new")[];
  reportsRetentionDays: number;
}
