param([string]$Address = '', [int]$Port = 8767)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$atlasPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $atlasPython)) { throw 'Run Install.ps1 first.' }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Use a port between 1024 and 65535.' }
if (-not $Address) {
    $Address = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|VMware|VirtualBox|Tailscale|WSL' } | Select-Object -First 1 -ExpandProperty IPAddress
}
if (-not $Address) { throw 'No private IPv4 found. Pass -Address with the Wi-Fi/Ethernet IPv4 address.' }
if (-not (Test-Path -LiteralPath 'dist\index.html')) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
}
# ponytail: browser-native Basic authentication is enough for trusted local Wi-Fi; use HTTPS before any wider hosting.
$atlasPassword = & $atlasPython -c 'import secrets; print(secrets.token_urlsafe(24))'
if ($LASTEXITCODE -ne 0) { throw 'Password generation failed.' }
$atlasPreviousHost = $env:FLIGHT_ATLAS_LAN_HOST
$atlasPreviousPassword = $env:FLIGHT_ATLAS_LAN_PASSWORD
try {
    $env:FLIGHT_ATLAS_LAN_HOST = $Address
    $env:FLIGHT_ATLAS_LAN_PASSWORD = $atlasPassword
    Write-Host "Phone URL (same trusted Wi-Fi): http://${Address}:$Port"
    Write-Host 'Username: atlas'
    Write-Host "Session password: $atlasPassword"
    Write-Host 'Keep this window open. Ctrl+C stops mobile access. If Windows asks, allow private networks only.'
    & $atlasPython -m uvicorn backend:app --host $Address --port $Port
    if ($LASTEXITCODE -ne 0) { throw 'Mobile server exited with an error.' }
} finally {
    $env:FLIGHT_ATLAS_LAN_HOST = $atlasPreviousHost
    $env:FLIGHT_ATLAS_LAN_PASSWORD = $atlasPreviousPassword
}
