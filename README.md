# TrEL Data

TrEL 신호 처리 및 분석 자동화 도구

## 설치

가상환경(`.venv`) 없이 시스템 Python 기준으로 설치합니다.

**Windows**
```bash
pnpm install
pip install -r requirements.txt
```

**macOS / Linux**
```bash
pnpm install
python3 -m pip install -r requirements.txt
```

`pnpm install`만으로는 백엔드 Python 패키지가 설치되지 않으므로, 위 Python 의존성 설치는 1회 필요합니다.

## 실행

**Windows:**
```bash
pnpm dev:all
```

**Mac/Linux:**
```bash
pnpm dev:all:mac
```

프론트엔드: http://localhost:3000  
백엔드: http://localhost:8080

## 요구사항

- Node.js >= 18.0.0
- pnpm >= 9.0.0
- Python 3.8+  
  - Windows: `python` 명령어 필요  
  - Mac/Linux: `python3` 명령어 필요

## 플랫폼 호환성

✅ Windows (PowerShell, CMD)  
✅ macOS  
✅ Linux
