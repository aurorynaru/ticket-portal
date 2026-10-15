# P0 local container-contract smoke test.
# Simulates the Docker runtime contract (docs/17) without Docker:
#   node dist/server.js against a volume-like directory, health checks,
#   data persistence across a graceful restart.
# Usage: powershell -ExecutionPolicy Bypass -File checks/p0/smoke.ps1  (from repo root)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$vol = Join-Path $env:TEMP 'ticketing-p0-data'
Remove-Item -Recurse -Force $vol -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $vol | Out-Null

$env:NODE_ENV = 'development'
$env:PORT = '3199'
$env:DATABASE_PATH = (Join-Path $vol 'tickets.db')
$env:UPLOAD_DIR = (Join-Path $vol 'uploads')
$env:LOG_LEVEL = 'info'

$firstProc = $null
$secondProc = $null
$failed = $false

function Start-App {
  return Start-Process -FilePath 'node' -ArgumentList 'dist\server.js' -WorkingDirectory $repoRoot `
    -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $vol 'server-out.log') `
    -RedirectStandardError (Join-Path $vol 'server-err.log')
}

function Wait-Healthy($port) {
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 250
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health/live" -UseBasicParsing -TimeoutSec 1
      if ($r.StatusCode -eq 200) { return $true }
    } catch { }
  }
  return $false
}

# Stop the server. On Linux (Docker runtime) SIGTERM triggers the app's
# graceful shutdown handler. On Windows, cross-process SIGTERM via
# process.kill() terminates without invoking handlers (Node limitation),
# so this machine verifies process exit + data persistence; the graceful
# shutdown sequence itself is covered by tests/shutdown.test.ts.
# .NET Process.ExitCode is unreliable for Start-Process -PassThru with
# redirected output on Windows PowerShell 5.1, so we verify HasExited.
function Stop-Gracefully([System.Diagnostics.Process]$proc) {
  if ($null -eq $proc -or $proc.HasExited) { return }
  & node -e "process.kill(Number(process.argv[1]), 'SIGTERM')" $proc.Id 2>$null | Out-Null
  if (-not $proc.WaitForExit(10000)) {
    Write-Output "WARN: process $($proc.Id) did not exit after SIGTERM; force-killing"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    $proc.WaitForExit(5000) | Out-Null
  }
}

try {
  $firstProc = Start-App
  if (-not (Wait-Healthy 3199)) {
    Write-Output 'FAIL: server did not become live (first start)'
    Get-Content (Join-Path $vol 'server-err.log') -ErrorAction SilentlyContinue
    $failed = $true
  } else {
    Write-Output 'PASS: /health/live 200 (first start)'

    $ready = Invoke-WebRequest -Uri 'http://127.0.0.1:3199/health/ready' -UseBasicParsing
    Write-Output "ready-status=$($ready.StatusCode) body=$($ready.Content)"
    if ($ready.StatusCode -ne 200) { $failed = $true }

    $index = Invoke-WebRequest -Uri 'http://127.0.0.1:3199/' -UseBasicParsing
    Write-Output "index-status=$($index.StatusCode) has-css=$($index.Content -match '/assets/app.css') has-htmx=$($index.Content -match '/htmx.min.js')"
    if ($index.StatusCode -ne 200) { $failed = $true }

    $marker = @'
const { createRequire } = require('module');
const repoRequire = createRequire(process.argv[3] + '/package.json');
const Database = repoRequire('better-sqlite3');
const db = new Database(process.argv[2]);
db.pragma('journal_mode = WAL');
db.prepare('INSERT INTO app_ticket_number_seq DEFAULT VALUES').run();
const row = db.prepare('SELECT last_insert_rowid() AS id').get();
console.log('marker-rowid=' + row.id);
db.close();
'@
    Set-Content -LiteralPath (Join-Path $vol 'marker.cjs') -Value $marker -Encoding ascii
    & node (Join-Path $vol 'marker.cjs') (Join-Path $vol 'tickets.db') $repoRoot

    Stop-Gracefully $firstProc
    Write-Output "first-run-exited=$($firstProc.HasExited)"
    if (-not $firstProc.HasExited) { $failed = $true }

    $secondProc = Start-App
    if (-not (Wait-Healthy 3199)) {
      Write-Output 'FAIL: server did not become live (second start)'
      $failed = $true
    } else {
      Write-Output 'PASS: /health/live 200 (second start)'

      $verify = @'
const { createRequire } = require('module');
const repoRequire = createRequire(process.argv[3] + '/package.json');
const Database = repoRequire('better-sqlite3');
const db = new Database(process.argv[2]);
const rows = db.prepare('SELECT id FROM app_ticket_number_seq ORDER BY id DESC LIMIT 1').get();
console.log('persisted-max-rowid=' + (rows ? rows.id : 'none'));
const ver = db.prepare('SELECT MAX(version) AS v FROM app_schema_migrations').get();
console.log('schema-version=' + ver.v);
db.close();
'@
      Set-Content -LiteralPath (Join-Path $vol 'verify.cjs') -Value $verify -Encoding ascii
      & node (Join-Path $vol 'verify.cjs') (Join-Path $vol 'tickets.db') $repoRoot
    }
  }
}
finally {
  Stop-Gracefully $firstProc
  Stop-Gracefully $secondProc
}

if ($failed) {
  Write-Output 'SMOKE-FAILED'
  exit 1
}
Write-Output 'SMOKE-DONE'
exit 0