# Git 설정 및 GitHub Push 가이드

## 1. Git 설치

Git이 설치되어 있지 않습니다. 다음 중 하나의 방법으로 설치하세요:

### 방법 1: 공식 웹사이트에서 설치
1. https://git-scm.com/download/win 방문
2. 다운로드 후 설치
3. 설치 후 PowerShell을 재시작

### 방법 2: Chocolatey 사용 (관리자 권한 필요)
```powershell
choco install git
```

### 방법 3: Winget 사용
```powershell
winget install --id Git.Git -e --source winget
```

## 2. Git 초기화 및 Push

Git 설치 후 다음 명령어를 실행하세요:

```powershell
cd "d:\Cursor\10. TrEL data"

# Git 초기화
git init

# .gitignore 확인 (이미 존재함)
# node_modules, .venv 등은 자동으로 제외됩니다

# 모든 파일 추가
git add .

# 첫 커밋
git commit -m "Initial commit: TrEL Data Processing Project"

# 원격 저장소 추가
git remote add origin https://github.com/jinwooparkoffice/10.-TrEL-data.git

# GitHub에 push
git branch -M main
git push -u origin main
```

## 3. 인증 문제 발생 시

GitHub에 push할 때 인증이 필요할 수 있습니다:

### Personal Access Token 사용 (권장)
1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. "Generate new token" 클릭
3. 권한 선택: `repo` 체크
4. 토큰 생성 후 복사
5. push 시 비밀번호 대신 토큰 입력

### 또는 SSH 키 사용
```powershell
# SSH 키 생성
ssh-keygen -t ed25519 -C "your_email@example.com"

# 공개 키 복사
cat ~/.ssh/id_ed25519.pub

# GitHub → Settings → SSH and GPG keys → New SSH key에 추가
```

## 4. 이후 업데이트

코드 변경 후:
```powershell
git add .
git commit -m "설명 메시지"
git push
```
