# SonarQube CE Scan

Run a SonarQube Community Edition code analysis in an ephemeral Docker container
— no external server required.

## Usage

```yaml
- name: SonarQube Scan
  uses: mammothb/sonarqube-ce@main
  with:
    reports-scopes: '["overall","new"]'
```

### Minimal

```yaml
- name: SonarQube Scan
  uses: mammothb/sonarqube-ce@main
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `sonar-project-name` | No | `${{ github.event.repository.name }}` | SonarQube project name (also used as project key) |
| `sonar-source-path` | No | `.` | Source path from git root |
| `sonar-server-image` | No | `sonarqube:25.5.0.107428-community` | SonarQube CE Docker image |
| `sonar-scanner-image` | No | `sonarsource/sonar-scanner-cli:11.3` | Scanner CLI Docker image |
| `sonar-options` | No | | Extra Sonar Scanner options (`-Dsonar.rust.clippy.reportPaths=...`) |
| `pre-scan-script` | No | | Path or inline script run before scan (installs toolchains, generates analyzer reports) |
| `generate-pr-comment` | No | `false` | Post analysis summary as PR comment |
| `new-code-n-days` | No | `30d` | Days for new-code period |
| `reports-scopes` | No | `[]` | Report scopes: `["overall","new"]`, `["new"]`, or `[]` |
| `reports-retention-days` | No | `7` | Artifact retention in days |

## Outputs

| Output | Description |
| --- | --- |
| `analysis-summary` | Analysis summary markdown (also written to step summary) |
| `overall-reports-artifact-id` | Overall reports artifact ID (when `reports-scopes` includes `"overall"`) |
| `new-reports-artifact-id` | New-code reports artifact ID (when `reports-scopes` includes `"new"`) |

## PR Comments

Set `generate-pr-comment: 'true'` and ensure the workflow has
`pull-requests: write` permission. The action will create or update a bot
comment with the analysis summary and artifact download links.

```yaml
jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
      - uses: mammothb/sonarqube-ce@main
        with:
          generate-pr-comment: 'true'
          reports-scopes: '["overall","new"]'
```

## How It Works

1. Pulls SonarQube Community Edition and Scanner CLI Docker images (cached
   between runs)
1. Starts an ephemeral SonarQube instance on a Docker network
1. Waits for boot, changes the default admin password
1. Creates a project and generates a user token
1. Runs the scanner against your source code
1. Waits for the quality gate to compute
1. Fetches metrics, issues, and security hotspots
1. Optionally generates markdown reports and uploads them as workflow artifacts
1. Writes a step summary and optionally posts a PR comment
1. Stops and removes the container (always, even on failure)

### Pre-scan scripts

Use `pre-scan-script` to install language toolchains or generate external
analyzer reports before the scanner runs:

```yaml
- uses: mammothb/sonarqube-ce@main
  with:
    pre-scan-script: |
      rustup component add clippy
      cargo clippy --message-format json > clippy-report.json
    sonar-options: -Dsonar.rust.clippy.reportPaths=clippy-report.json
```

## Requirements

- **Docker** must be available on the runner (included on `ubuntu-latest`,
  `windows-latest`, and self-hosted runners with Docker)
- **Node.js 24** runtime (`using: node24`)
