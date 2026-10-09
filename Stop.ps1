$ErrorActionPreference = 'Stop'
$atlasPidFile = Join-Path $PSScriptRoot 'data\server.pid'
if (-not (Test-Path -LiteralPath $atlasPidFile)) { Write-Host 'No recorded Atlas process.'; exit }
$atlasPid = [int](Get-Content -LiteralPath $atlasPidFile)
$atlasProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$atlasPid"
if ($atlasProcess) {
    $atlasExpected = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
    if ($atlasProcess.ExecutablePath -ne $atlasExpected -or $atlasProcess.CommandLine -notmatch 'uvicorn backend:app') { throw 'Recorded PID belongs to another process; not stopped.' }
    Stop-Process -Id $atlasPid
}
Remove-Item -LiteralPath $atlasPidFile
Write-Host 'Personal Flight Atlas stopped. Data retained.'
