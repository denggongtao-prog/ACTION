param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$cncUrl = 'http://127.0.0.1:8786/'
$cncNode = Get-Command node -ErrorAction Stop
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/vite/bin/vite.js'))) {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
$cncReady = $false
try {
    $cncResponse = Invoke-WebRequest -Uri $cncUrl -UseBasicParsing -TimeoutSec 2
    if ($cncResponse.Content -match 'cnc|src/main.ts|simulator') { $cncReady = $true }
    else { throw 'Port 8786 is used by another application.' }
} catch {
    if ($_.Exception.Message -match 'another application') { throw }
}
if (-not $cncReady) {
    $cncLogs = Join-Path $PSScriptRoot '.local'
    New-Item -ItemType Directory -Force -Path $cncLogs | Out-Null
    $cncArgs = @('node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','8786','--strictPort')
    $cncProcess = Start-Process -FilePath $cncNode.Source -ArgumentList $cncArgs -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $cncLogs 'dev.log') -RedirectStandardError (Join-Path $cncLogs 'dev-error.log')
    Set-Content -LiteralPath (Join-Path $cncLogs 'dev.pid') -Value $cncProcess.Id -Encoding ascii
    for ($cncAttempt = 0; $cncAttempt -lt 25; $cncAttempt++) {
        Start-Sleep -Milliseconds 400
        try {
            $cncResponse = Invoke-WebRequest -Uri $cncUrl -UseBasicParsing -TimeoutSec 1
            if ($cncResponse.StatusCode -eq 200) { $cncReady = $true; break }
        } catch {}
        if ($cncProcess.HasExited) { throw 'Vite exited. Inspect .local/dev-error.log.' }
    }
}
if (-not $cncReady) { throw 'Simulator startup timed out. Inspect .local logs.' }
Write-Output ('Simulator: ' + $cncUrl)
Write-Output ('Host demo: ' + $cncUrl + 'host.html')
if (-not $NoOpen) { Start-Process $cncUrl }

