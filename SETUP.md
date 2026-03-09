# TrEL Data - 실행 가이드

## 빠른 실행

```powershell
pnpm dev:all
```

## 설치 오류가 발생하는 경우

프로젝트가 **OneDrive 동기화 폴더**(Documents) 또는 **한글 경로**에 있으면 파일 쓰기 오류가 발생할 수 있습니다.

**해결 방법:** 프로젝트를 한글 없는 경로로 복사 후 실행

```powershell
# 예: C:\Projects\TrEL-data 로 복사
xcopy "G:\다른 컴퓨터\내 노트북\Documents\Cursor\10. TrEL data" "C:\Projects\TrEL-data" /E /I /H
cd C:\Projects\TrEL-data
pnpm install
pnpm dev:all
```

그 후 http://localhost:3000 에서 접속
