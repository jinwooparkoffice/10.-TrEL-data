# node_modules 손상 시 복구 스크립트
# 사용법: 1) dev 서버 종료(Ctrl+C) 2) .\repair.ps1
Write-Host "Repairing node_modules..." -ForegroundColor Cyan
pnpm install
if ($LASTEXITCODE -eq 0) {
    Write-Host "Done. Run pnpm dev:all" -ForegroundColor Green
} else {
    Write-Host "If still broken: close Cursor, delete node_modules folder manually, then run pnpm install" -ForegroundColor Yellow
}
