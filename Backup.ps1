$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot '.venv\Scripts\python.exe') (Join-Path $PSScriptRoot 'backup.py')
if ($LASTEXITCODE -ne 0) { throw 'Backup failed.' }
