# TrEL Data

TrEL 데이터 분석 및 처리 프로젝트

## 요구사항

- Python 3.8 이상
- Node.js 18 이상
- pnpm 9.0 이상

## 설치 및 실행

### 방법 1: 스크립트 사용 (권장)

#### Mac/Linux
```bash
# 초기 설정 (최초 1회만)
./setup.sh

# 프로젝트 실행
./run.sh
```

#### Windows
```cmd
# 초기 설정 (최초 1회만)
setup.bat

# 프로젝트 실행
run.bat
```

### 방법 2: 수동 실행

1. **가상환경 생성 및 활성화**
   ```bash
   # Mac/Linux
   python3 -m venv .venv
   source .venv/bin/activate
   
   # Windows
   python -m venv .venv
   .venv\Scripts\activate
   ```

2. **의존성 설치**
   ```bash
   pip install -r requirements.txt
   pnpm install
   ```

3. **프로젝트 실행**
   ```bash
   # 프론트엔드와 백엔드 동시 실행
   pnpm run dev:all:direct
   
   # 또는 개별 실행
   pnpm dev              # 프론트엔드만 (포트 3000)
   python app.py         # 백엔드만 (포트 8080)
   ```

## 접속 주소

- 프론트엔드: http://localhost:3000
- 백엔드 API: http://localhost:8080

## 프로젝트 구조

```
.
├── app.py              # Flask 백엔드 서버
├── requirements.txt    # Python 의존성
├── package.json        # Node.js 의존성
├── setup.sh            # Mac/Linux 초기 설정 스크립트
├── setup.bat           # Windows 초기 설정 스크립트
├── run.sh              # Mac/Linux 실행 스크립트
├── run.bat             # Windows 실행 스크립트
├── utils/              # 유틸리티 모듈
│   ├── vil_processor.py
│   ├── osc_processor.py
│   ├── master_processor.py
│   └── trel_analysis.py
└── src/                # React 프론트엔드 소스
```

## 주요 기능

- VIL 데이터 처리
- 오실로스코프 데이터 처리
- TrEL 분석
- 마스터 CSV 생성

## 라이선스

MIT
