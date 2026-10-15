# Local end-to-end load run: seed (if needed) -> start load app -> k6 -> report.
# Usage:
#   powershell -File scripts/load-run-local.ps1 -Duration 90s
#   powershell -File scripts/load-run-local.ps1 -Duration 5m -Scenario mixed
#   powershell -File scripts/load-run-local.ps1 -Scenario burst
param(
  [string]$Duration = '90s',
  [string]$Scenario = 'mixed',
  [int]$Port = 3199,
  [switch]$SkipSeed
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Find-K6 {
  $cmd = Get-Command k6 -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $fallback = Join-Path $env:ProgramFiles 'k6\k6.exe'
  if (Test-Path $fallback) { return $fallback }
  throw 'k6 not found. Install with: winget install GrafanaLabs.k6'
}

$secret = 'local-load-only-secret-0123456789abcdef'
$target = "http://127.0.0.1:$Port"

# 1. Seed the isolated load database.
if (-not $SkipSeed) {
  if (-not (Test-Path 'load/seed-manifest.json')) {
    Write-Host 'Seeding load database (first run only) ...'
    $env:BETTER_AUTH_SECRET = $secret
    $env:BETTER_AUTH_URL = $target
    npx tsx scripts/seed-load.ts
    if ($LASTEXITCODE -ne 0) { throw 'seed-load failed' }
  } else {
    Write-Host 'Using existing load/seed-manifest.json'
  }
}

# 2. Build if needed.
if (-not (Test-Path 'dist/server.js')) {
  Write-Host 'Building (npm run build) ...'
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
}

# 3. Start the load app instance (isolated DB, high rate limits for the
#    single-IP generator - see docs/10_TESTING_LOAD.md).
# NODE_ENV=development: the /data production guards apply to Railway only.
$env:NODE_ENV = 'development'
$env:PORT = "$Port"
$env:DATABASE_PATH = (Resolve-Path '.local/load/load.db').Path
$env:UPLOAD_DIR = (Resolve-Path '.local/load/uploads').Path
$env:BETTER_AUTH_SECRET = $secret
$env:BETTER_AUTH_URL = $target
$env:SESSION_TRUSTED_ORIGIN = $target
$env:RATE_LIMIT_MAX = '100000'
$env:RATE_LIMIT_AUTH_MAX = '100000'
$env:LOG_LEVEL = 'warn'

$app = Start-Process -FilePath 'node' -ArgumentList 'dist/server.js' -PassThru -WindowStyle Hidden
Write-Host "Load app started (pid $($app.Id)) on $target"

try {
  # 4. Wait for readiness.
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $r = Invoke-WebRequest -Uri "$target/health/ready" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { throw 'load app did not become ready' }
  Write-Host 'Load app ready.'

  # 5. Resource sampler in the background.
  $resCsv = "load/resources-$Scenario.csv"
  $sampler = Start-Process -FilePath 'powershell' -ArgumentList "-NoProfile -File scripts/load-resources.ps1 -Port $Port -OutFile $resCsv" -PassThru -WindowStyle Hidden

  # 6. Run k6.
  $k6 = Find-K6
  $script = if ($Scenario -eq 'burst') { 'load/k6/burst.js' } else { 'load/k6/mixed.js' }
  & $k6 run --env "TARGET=$target" --env "DURATION=$Duration" $script
  if ($LASTEXITCODE -ne 0) { Write-Warning 'k6 exited non-zero (thresholds may have failed)' }

  Stop-Process -Id $sampler.Id -Force -ErrorAction SilentlyContinue
}
finally {
  Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
  Write-Host "Load app stopped. Resource samples: load/resources-$Scenario.csv"
}