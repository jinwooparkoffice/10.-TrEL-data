# 프로젝트 폴더에서 직접 실행 - 프론트엔드/백엔드만 시작
$projectPath = $PSScriptRoot
Set-Location $projectPath

# vite.config.js가 vite 패키지를 import하므로, vite가 없으면 한 번만 설치
$vitePath = "node_modules\vite\package.json"
if (-not (Test-Path $vitePath) -or $args -contains "--install") {
    Write-Host "Installing dependencies (vite required for config)..." -ForegroundColor Cyan
    pnpm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Starting frontend and backend..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop immediately (process tree kill)." -ForegroundColor Gray

$pnpmExe = (Get-Command pnpm -ErrorAction Stop).Source
$pythonExe = (Get-Command python -ErrorAction Stop).Source

function Stop-ProcessTree {
    param([int]$PidToKill)

    if ($PidToKill -le 0) { return }
    try {
        & taskkill /PID $PidToKill /T /F | Out-Null
    } catch {
        # 이미 종료된 경우 무시
    }
}

$frontend = $null
$backend = $null

try {
    $frontend = Start-Process -FilePath $pnpmExe `
        -ArgumentList @("run", "dev") `
        -WorkingDirectory $projectPath `
        -NoNewWindow `
        -PassThru

    $backend = Start-Process -FilePath $pythonExe `
        -ArgumentList @("app.py") `
        -WorkingDirectory $projectPath `
        -NoNewWindow `
        -PassThru

    Write-Host "[frontend] PID: $($frontend.Id)" -ForegroundColor Cyan
    Write-Host "[backend]  PID: $($backend.Id)" -ForegroundColor Yellow

    while ($true) {
        $frontend.Refresh()
        $backend.Refresh()

        if ($frontend.HasExited -or $backend.HasExited) {
            if ($frontend.HasExited) {
                Write-Host "[frontend] exited with code: $($frontend.ExitCode)" -ForegroundColor Red
            }
            if ($backend.HasExited) {
                Write-Host "[backend] exited with code: $($backend.ExitCode)" -ForegroundColor Red
            }
            break
        }

        Start-Sleep -Milliseconds 250
    }
}
finally {
    Write-Host "Stopping all dev processes..." -ForegroundColor DarkGray
    if ($frontend) { Stop-ProcessTree -PidToKill $frontend.Id }
    if ($backend) { Stop-ProcessTree -PidToKill $backend.Id }
}
