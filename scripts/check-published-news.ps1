$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$logFolder = Join-Path $projectPath 'logs'
$null = [IO.Directory]::CreateDirectory($logFolder)
$logFile = Join-Path $logFolder ('publication-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')
$newsNode = (Get-Command node.exe -ErrorAction Stop).Source
& $newsNode (Join-Path $PSScriptRoot 'publish-if-missing.mjs') *> $logFile
exit $LASTEXITCODE
