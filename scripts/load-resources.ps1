# Samples the load app's memory/CPU while k6 runs, into a CSV.
# Usage: powershell -File scripts/load-resources.ps1 -Port 3199 -OutFile load/resources.csv
param(
  [int]$Port = 3199,
  [string]$OutFile = 'load/resources.csv',
  [int]$IntervalSeconds = 5
)

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $listener) {
  Write-Error "No listener on port $Port"
  exit 1
}
$proc = Get-Process -Id $listener.OwningProcess
"pid,timestamp,working_set_mb,cpu_seconds" | Set-Content -LiteralPath $OutFile

$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($true) {
  if (-not $proc.HasExited) {
    $wsMb = [math]::Round($proc.WorkingSet64 / 1MB, 1)
    $cpu = [math]::Round($proc.TotalProcessorTime.TotalSeconds, 1)
    Add-Content -LiteralPath $OutFile "$($proc.Id),$([DateTime]::UtcNow.ToString('o')),$wsMb,$cpu"
  } else {
    break
  }
  Start-Sleep -Seconds $IntervalSeconds
}