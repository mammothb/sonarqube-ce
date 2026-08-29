# SonarQube CE Scan

Run a SonarQube Community Edition code analysis in an ephemeral Docker container
— no external server required.

## Usage

```yaml
- name: SonarQube Scan
  uses: mammothb/sonarqube-ce@v1
  with:
    reports-scopes: '["overall","new"]'
```

### Minimal

```yaml
- name: SonarQube Scan
  uses: mammothb/sonarqube-ce@v1
```

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `sonar-project-name` | No | `${{ github.event.repository.name }}` | SonarQube project name (also used as project key) |
| `sonar-source-path` | No | `.` | Source path from git root |
| `sonar-server-image` | No | `sonarqube:25.5.0.107428-community` | SonarQube CE Docker image |
| `sonar-scanner-image` | No | `sonarsource/sonar-scanner-cli:11.3` | Scanner CLI Docker image |
| `scan-mode` | No | `cli` | `cli` runs the scanner in-step; `none` skips the scan and exposes connection outputs for an external scanner |
| `sonar-options` | No | | Extra Sonar Scanner options (`-Dsonar.rust.clippy.reportPaths=...`) |
| `pre-scan-script` | No | | Path or inline script run before scan (installs toolchains, generates analyzer reports) |
| `github-token` | No | `GITHUB_TOKEN` env var | GitHub token for PR comments |
| `generate-pr-comment` | No | `false` | Post analysis summary as PR comment |
| `new-code-n-days` | No | `30d` | Days for new-code period |
| `reports-scopes` | No | `[]` | Report scopes: `["overall","new"]`, `["new"]`, or `[]` |
| `reports-retention-days` | No | `7` | Artifact retention in days |

## Outputs

| Output | Description |
| --- | --- |
| `sonar-host-url` | Host-reachable SonarQube URL for external scanners (e.g. `http://localhost:9234`) |
| `sonar-project-key` | SonarQube project key (sanitized from `sonar-project-name`) |
| `sonar-token` | Generated user token (valid only for the ephemeral server) |
| `analysis-summary` | Analysis summary markdown (also written to step summary) |
| `overall-reports-artifact-id` | Overall reports artifact ID (when `reports-scopes` includes `"overall"`) |
| `new-reports-artifact-id` | New-code reports artifact ID (when `reports-scopes` includes `"new"`) |

## PR Comments

Set `generate-pr-comment: 'true'` and ensure the workflow has
`pull-requests: write` permission. The action will create or update a bot
comment with the analysis summary and artifact download links.

The action needs a GitHub token to post comments. You can pass it via
`with.github-token` **(recommended)** or `env.GITHUB_TOKEN`.

```yaml
jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
      - uses: mammothb/sonarqube-ce@v1
        with:
          generate-pr-comment: 'true'
          github-token: ${{ secrets.GITHUB_TOKEN }}
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
- uses: mammothb/sonarqube-ce@v1
  with:
    pre-scan-script: |
      rustup component add clippy
      cargo clippy --message-format json > clippy-report.json
    sonar-options: -Dsonar.rust.clippy.reportPaths=clippy-report.json
```

## C# / .NET projects

.NET code needs the **SonarScanner for .NET**, which wraps a real `dotnet build`
and runs on the host — not in the Scanner CLI container. Set `scan-mode: none`
to boot the server and expose connection details, then run the scanner yourself:

```yaml
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      # GitHub runners do not preinstall a .NET SDK
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Start SonarQube (server-only)
        id: sonar
        uses: mammothb/sonarqube-ce@v1
        with:
          scan-mode: 'none'
          reports-scopes: '["overall","new"]'  # optional; reported at job end

      - name: Install SonarScanner for .NET
        run: dotnet tool install --global dotnet-sonarscanner

      - name: Scan
        run: |
          dotnet sonarscanner begin \
            /k:"${{ steps.sonar.outputs.sonar-project-key }}" \
            /d:sonar.host.url="${{ steps.sonar.outputs.sonar-host-url }}" \
            /d:sonar.token="${{ steps.sonar.outputs.sonar-token }}"
          dotnet build
          dotnet sonarscanner end \
            /d:sonar.token="${{ steps.sonar.outputs.sonar-token }}"
```

Notes:

- Pass `sonar.host.url` and `sonar.token` as `/d:` flags — the .NET scanner
  does not read `SONAR_HOST_URL` / `SONAR_TOKEN` environment variables.
- The action's `post` phase waits for the quality gate, fetches metrics,
  generates reports, and tears down the server at the **end of the job**, so
  the server stays up across your scan step.
- The .NET scanner downloads its own JRE on first run (~100 MB, cached under
  `$HOME/.sonar`). Cache it, or set `sonar.scanner.skipJreProvisioning=true`
  with a locally installed JDK.
- `sonar-source-path` is ignored in `scan-mode: none` — the .NET scanner
  analyzes what the build compiles.

## Requirements

- **Docker** must be available on the runner (included on `ubuntu-latest`,
  `windows-latest`, and self-hosted runners with Docker)
- **Node.js 24** runtime (`using: node24`)
