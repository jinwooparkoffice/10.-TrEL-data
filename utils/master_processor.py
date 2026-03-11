"""
TrEL 마스터 파일 생성 (VIL 기반)
1. VIL t-relative luminance에서 100%, 75%, 50%, 25% 시점 보간
2. time_shift 적용 후 TrEL 파일 중 가장 가까운 파일 선택
3. 선택된 4개 파일 데이터를 가로로 병렬 배치, 3행에 100%/75%/50%/25% 표시
"""
import io
import re
from typing import List, Dict, Tuple, Optional
import numpy as np
import pandas as pd
import openpyxl

def parse_vil_processed(content: str) -> pd.DataFrame:
    """
    VIL 처리된 CSV 파싱 (Pandas Optimized)
    Returns: DataFrame with columns ['Time (min)', 'Relative luminance (a.u.)']
    """
    try:
        # 주석 행 무시하고 읽기
        df = pd.read_csv(io.StringIO(content), comment='#')
        # 컬럼명 공백 제거
        df.columns = df.columns.str.strip()
        
        # 필요한 컬럼만 선택
        time_col = next((c for c in df.columns if 'Time (min)' in c), None)
        rel_lum_col = next((c for c in df.columns if 'Relative luminance' in c), None)
        
        if time_col and rel_lum_col:
            res = df[[time_col, rel_lum_col]].copy()
            res.columns = ['Time (min)', 'Relative luminance (a.u.)'] # Normalize names
            return res
            
        # 컬럼명이 다를 경우 인덱스로 접근 (Fallback: 0, 3)
        if len(df.columns) >= 4:
            res = df.iloc[:, [0, 3]].copy()
            res.columns = ['Time (min)', 'Relative luminance (a.u.)']
            return res
            
    except Exception:
        pass
    return pd.DataFrame()


def interpolate_time_at_ratio(t_min: np.ndarray, rel_lum: np.ndarray, target_ratio: float) -> Optional[float]:
    """
    rel_lum이 target_ratio를 교차하는 t_min 보간
    """
    if len(t_min) < 2 or len(rel_lum) < 2:
        return None
    
    # Vectorized search using numpy
    # rel_lum이 감소한다고 가정하거나, 교차점을 찾아야 함.
    # 단순화를 위해 기존 로직과 유사하게 순차 탐색하되 numba 등을 안쓰면 python loop가 됨.
    # numpy where를 써서 구간을 찾음
    
    # a >= target >= b OR a <= target <= b
    diff = rel_lum - target_ratio
    # 부호가 바뀌는 지점 찾기 (0을 지나는 지점)
    # diff[i] * diff[i+1] <= 0
    
    # 정확히 0인 점이 있으면 그 점 반환, 아니면 보간
    # 여기서는 기존 로직의 정확성을 유지하기 위해 Python loop를 쓰되, 데이터가 아주 많지 않으므로 괜찮음.
    # VIL 데이터는 보통 수천 포인트 이내.
    
    for i in range(len(t_min) - 1):
        a, b = rel_lum[i], rel_lum[i + 1]
        ta, tb = t_min[i], t_min[i + 1]
        if (a >= target_ratio >= b) or (a <= target_ratio <= b):
            if abs(b - a) < 1e-12:
                return ta
            frac = (target_ratio - a) / (b - a)
            return ta + frac * (tb - ta)
    return None


def parse_minutes_from_filename(filename: str) -> Optional[float]:
    """
    파일명에서 측정 시간(분) 추출
    - 1min -> 1, 1h2min -> 62, 57min -> 57
    Returns: 분 단위 float
    """
    m = re.search(r'(\d+)h(\d+)min', filename, re.IGNORECASE)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    m = re.search(r'(\d+)min', filename, re.IGNORECASE)
    if m:
        return float(m.group(1))
    return None


def parse_minutes_display(filename: str) -> Optional[str]:
    """표시용: 1min, 1h 2min 등"""
    m = re.search(r'(\d+)h(\d+)min', filename, re.IGNORECASE)
    if m:
        h, mn = int(m.group(1)), int(m.group(2))
        return f"{h}h {mn}min" if h > 0 else f"{mn}min"
    m = re.search(r'(\d+)min', filename, re.IGNORECASE)
    if m:
        return f"{m.group(1)}min"
    return None


def parse_trel_csv(content: str) -> pd.DataFrame:
    """
    TrEL 처리된 CSV 파싱 (Pandas Optimized)
    Returns: DataFrame with data
    """
    try:
        # Auto-detect header/start of data
        lines = content.splitlines()
        start_idx = 3 # Default fallback
        for i, line in enumerate(lines[:20]):
            if re.match(r'^\s*-?\d', line):
                start_idx = i
                break
        
        # skiprows=start_idx: 헤더 포함 start_idx줄 건너뜀 (start_idx+1번째 줄부터 데이터)
        # header=None: 컬럼명 없음
        df = pd.read_csv(io.StringIO(content), skiprows=start_idx, header=None)
        
        if df.shape[1] == 3:
             # 3 columns: Time, Shifted, Intensity (No Current)
             df[3] = np.nan # Add 4th column as NaN
             
        if df.shape[1] >= 4:
            df.columns = ['Time (μs)', 'Shifted Time (μs)', 'Normalized intensity (a.u.)', 'Current density (mA cm⁻²)']
            return df
    except Exception:
        pass
    return pd.DataFrame()


def find_closest_file(files_with_minutes: List[Tuple[str, float]], target_min: float) -> Optional[Tuple[str, float]]:
    """target_min에 가장 가까운 (filename, minutes) 반환"""
    if not files_with_minutes:
        return None
    return min(files_with_minutes, key=lambda x: abs(x[1] - target_min))


def process_master(
    vil_processed_csv: str,
    vil_time_shift_min: float,
    trel_files_data: List[Tuple[str, str]],
    percent_list: Optional[List[int]] = None,
) -> Tuple[bytes, List[Dict], Dict]:
    """
    VIL 기반 마스터 XLSX 생성 (Pandas & Openpyxl Optimized)
    """
    decay_thresholds = [p / 100.0 for p in (percent_list or [100, 75, 50, 25])]
    pct_labels = [f"{int(p * 100)}%" for p in decay_thresholds]

    # 1. VIL 데이터 로드
    vil_df = parse_vil_processed(vil_processed_csv)
    if len(vil_df) < 5:
        raise ValueError("VIL 데이터가 부족합니다. (최소 5개 포인트 필요)")

    t_min = vil_df.iloc[:, 0].values
    rel_lum = vil_df.iloc[:, 1].values

    times_before_shift = {}
    for ratio in decay_thresholds:
        t = interpolate_time_at_ratio(t_min, rel_lum, ratio)
        times_before_shift[ratio] = t

    # 2. time_shift 적용 후 목표 시간
    target_times = {}
    for ratio in decay_thresholds:
        t = times_before_shift.get(ratio)
        if t is not None:
            target_times[ratio] = t + vil_time_shift_min
        else:
            target_times[ratio] = None

    # 3. TrEL 파일 목록에서 분 추출
    files_with_minutes = []
    for filename, _ in trel_files_data:
        mins = parse_minutes_from_filename(filename)
        if mins is not None:
            files_with_minutes.append((filename, mins))

    if not files_with_minutes:
        raise ValueError("TrEL 파일명에서 측정 시간(분)을 추출할 수 없습니다. (예: 1min, 57min)")

    # 4. 각 목표 시간에 가장 가까운 파일 선택
    selected = {}
    for ratio in decay_thresholds:
        t_target = target_times.get(ratio)
        if t_target is None:
            continue
        closest = find_closest_file(files_with_minutes, t_target)
        if closest:
            selected[ratio] = closest  # (filename, minutes)

    # 5. 선택된 파일 데이터 로드 및 병합 준비
    trel_by_name = {f: c for f, c in trel_files_data}
    
    # 6. 마스터 XLSX: Write-Only Mode (메모리 최적화)
    wb = openpyxl.Workbook(write_only=True)
    ws = wb.create_sheet(title="TrEL_Master")
    
    col_headers = ['Time (μs)', 'Shifted Time (μs)', 'Normalized intensity (a.u.)', 'Current density (mA cm⁻²)']
    
    # 1행: 헤더
    row1 = []
    for _ in pct_labels:
        row1.extend(col_headers)
    ws.append(row1)
    
    # 2행: 빈 행
    ws.append([])
    
    # 3행: 퍼센트 라벨
    row3 = []
    for pct in pct_labels:
        row3.extend([pct] * 4)
    ws.append(row3)
    
    # 데이터 준비
    data_frames = []
    files_used = []
    
    max_len = 0
    
    for ratio in decay_thresholds:
        if ratio in selected:
            filename, mins = selected[ratio]
            content = trel_by_name.get(filename)
            df = parse_trel_csv(content) if content else pd.DataFrame()
        else:
            filename = None
            df = pd.DataFrame()
            
        if not df.empty:
            max_len = max(max_len, len(df))
            data_frames.append(df)
            if filename:
                files_used.append({
                    'filename': filename,
                    'minutes': parse_minutes_display(filename) or f"{mins}min",
                    'percent': pct_labels[decay_thresholds.index(ratio)],
                })
        else:
            # 빈 DataFrame (4개 컬럼)
            data_frames.append(pd.DataFrame(columns=col_headers))
            
    # 4행부터: 데이터 쓰기
    # 모든 DataFrame을 하나의 DataFrame으로 가로 병합 (concat)
    # 길이가 다르면 NaN으로 채워짐 -> 빈 문자열로 변환 필요
    
    if data_frames:
        # 각 DataFrame의 인덱스를 리셋하여 병합 시 정렬 문제 방지
        dfs_reset = [df.reset_index(drop=True) for df in data_frames]
        # 가로 병합
        master_df = pd.concat(dfs_reset, axis=1)
        # NaN을 빈 문자열로 변환
        master_df = master_df.fillna('')
        
        # 행 단위로 append (openpyxl write-only는 iterable을 받음)
        # DataFrame.values는 numpy array -> tolist()로 변환
        for row in master_df.values.tolist():
            ws.append(row)
            
    metadata = {
        'files_used': files_used,
        'target_times_min': target_times,
    }
    summary = [{'file': f['filename'], 'success': True, 'minutes': f['minutes'], 'percent': f['percent']} for f in files_used]
    
    output = io.BytesIO()
    wb.save(output)
    return output.getvalue(), summary, metadata

