param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$atlasUrl = 'http://127.0.0.1:8765'
$atlasPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath $atlasPython)) { throw 'Run Install.ps1 first.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'dist\index.html'))) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
}
$atlasRunning = $false
try { $atlasHealth = Invoke-RestMethod "$atlasUrl/api/health" -TimeoutSec 2; $atlasRunning = $atlasHealth.name -eq 'Personal Flight Atlas' } catch {}
if (-not $atlasRunning) {
    if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8765 is occupied by another service. It has not been stopped.' }
    $atlasProcess = Start-Process -FilePath $atlasPython -ArgumentList @('-m','uvicorn','backend:app','--host','127.0.0.1','--port','8765') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'server-error.log') -PassThru
    $atlasProcess.Id | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'data\server.pid')
    for ($atlasAttempt = 0; $atlasAttempt -lt 40; $atlasAttempt++) {
        Start-Sleep -Milliseconds 250
        try { $atlasHealth = Invoke-RestMethod "$atlasUrl/api/health" -TimeoutSec 1; if ($atlasHealth.name -eq 'Personal Flight Atlas') { $atlasRunning = $true; break } } catch {}
        if ($atlasProcess.HasExited) { break }
    }
    if (-not $atlasRunning) { throw 'Server did not start. See server-error.log.' }
}
Write-Host "Personal Flight Atlas is running: $atlasUrl"
if (-not $NoBrowser) { Start-Process $atlasUrl }
