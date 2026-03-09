"""
TrEL (Transient Electroluminescence) 오실로스코프 데이터 처리
- 입력: time_ms, CH1_V(PMT), CH2_V(Current), CH3_V, CH4_V(Voltage/Trigger)
- 실험 셋업:
  - Trigger: Voltage ON (t=0)
  - CH1: PMT (Negative signal -> Invert needed)
  - CH2: LED와 직렬 연결된 100Ω 저항 양단 전압
    - 오실로스코프 입력 임피던스 50Ω과 병렬 연결됨
    - R_TOTAL = (100 * 50) / (100 + 50) = 33.33Ω
  - Area: 4.3 mm² (기본값)
- 출력: 
  - Time (μs): Raw Time (t=0 at Trigger/Voltage ON)
  - Shifted Time (μs): Decay Analysis Time (t=0 at Voltage OFF)
  - Norm. Luminance
  - Current Density
"""
import re
import io
import csv
from typing import Optional, Tuple, List, Dict
import pandas as pd
import numpy as np

# 실험 상수
R_SERIES = 100.0  # 직렬 저항 (Ω)
R_OSC = 50.0      # 오실로스코프 입력 임피던스 (Ω)
R_TOTAL = (R_SERIES * R_OSC) / (R_SERIES + R_OSC)  # 33.333... Ω

DEVICE_AREA_MM2 = 4.3
AREA_CM2 = DEVICE_AREA_MM2 * 1e-2  # 0.043 cm²


def parse_frequency_duty(filename: str) -> Tuple[Optional[float], Optional[float]]:
    """
    파일명에서 Frequency(Hz), Duty(%) 추출
    형식: 260223_CC_7000uA_1000Hz_duty25%_1h0min.csv
    """
    freq_match = re.search(r'(\d+(?:\.\d+)?)\s*Hz', filename, re.IGNORECASE)
    duty_match = re.search(r'duty\s*(\d+(?:\.\d+)?)\s*%?', filename, re.IGNORECASE)
    
    freq = float(freq_match.group(1)) if freq_match else None
    
    duty_pct = None
    if duty_match:
        val = float(duty_match.group(1))
        # duty25 -> 0.25, duty0.5 -> 0.005? 보통 파일명엔 % 단위 사용 (25 = 25%)
        duty_pct = val / 100.0 if val > 1.0 else val
        
    return freq, duty_pct


def load_osc_csv(content: str) -> pd.DataFrame:
    """
    오실로스코프 CSV를 Pandas DataFrame으로 로드하고 컬럼명을 표준화합니다.
    """
    try:
        # 1차 시도: 일반적인 CSV 읽기
        df = pd.read_csv(io.StringIO(content))
        
        # 컬럼명 소문자 변환 및 공백 제거
        df.columns = df.columns.str.lower().str.strip()
        
        # 'time' 컬럼이 없으면 헤더가 다른 줄에 있을 수 있음
        if not any('time' in col for col in df.columns):
            # 2차 시도: 헤더를 찾아서 다시 읽기 (최대 10줄 검색)
            lines = content.split('\n')
            header_row = -1
            for i, line in enumerate(lines[:10]):
                if 'time' in line.lower():
                    header_row = i
                    break
            
            if header_row != -1:
                df = pd.read_csv(io.StringIO(content), header=header_row)
                df.columns = df.columns.str.lower().str.strip()
            else:
                 raise ValueError("Time 컬럼을 찾을 수 없습니다.")

        # 단위 행(Unit Row) 제거: 데이터가 숫자가 아닌 경우 NaN 처리 후 드랍
        # 첫 번째 행의 첫 번째 컬럼이 숫자로 변환 불가능하면 단위 행으로 간주
        if len(df) > 0:
            first_val = df.iloc[0, 0]
            try:
                float(str(first_val))
            except ValueError:
                 df = df.iloc[1:].reset_index(drop=True)
             
        # 모든 데이터를 숫자로 변환 (오류 발생 시 NaN)
        df = df.apply(pd.to_numeric, errors='coerce')
        # Inf, -Inf를 NaN으로 변환
        df.replace([np.inf, -np.inf], np.nan, inplace=True)
        # 여기서 전체 dropna를 하면 안됨 (불필요한 컬럼이 비어있을 수 있음)
        # df = df.dropna(how='any') 
        
        return df

    except Exception as e:
        raise ValueError(f"CSV 파싱 오류: {str(e)}")


def process_osc_data(
    csv_content: str,
    baseline_start_ns: float,
    baseline_end_ns: float,
    frequency_hz: float,
    duty_fraction: float,
    filename: str = "",
    norm_start_ns: Optional[float] = None,
    norm_end_ns: Optional[float] = None,
) -> Tuple[str, Dict]:
    """
    오실로스코프 TrEL 데이터 처리 (Pandas Optimized)
    """
    df = load_osc_csv(csv_content)

    # 필수 컬럼 찾기 (유연한 매칭)
    cols = df.columns
    time_col = next((c for c in cols if 'time' in c), None)
    ch1_col = next((c for c in cols if 'ch1' in c), None) # PMT (Light)
    ch2_col = next((c for c in cols if 'ch2' in c), None) # Current (Voltage across R)
    # CH4 (Trigger) Optional
    
    if not time_col: raise ValueError("Time 컬럼 없음")
    if not ch1_col: raise ValueError("CH1(Light) 컬럼 없음")
    if not ch2_col: raise ValueError("CH2(Current) 컬럼 없음")

    # 필수 컬럼에 NaN이 있는 행 제거 (ch3, ch4가 비어있어도 ch1, ch2, time이 있으면 유지)
    df.dropna(subset=[time_col, ch1_col, ch2_col], inplace=True)

    if len(df) == 0:
        raise ValueError("필수 데이터(Time, CH1, CH2)가 모두 유효한 행이 없습니다.")

    # 벡터 연산 준비
    t_ms = df[time_col].values
    ch1 = df[ch1_col].values
    ch2 = df[ch2_col].values
    
    # ms -> ns 변환
    t_ns = t_ms * 1e6

    # 1. CH1 (Light): Baseline Correction & Inversion & Normalization
    # Invert signal (PMT negative signal)
    l_raw_inverted = -ch1
    
    # Baseline mask
    mask_base = (t_ns >= baseline_start_ns) & (t_ns <= baseline_end_ns)
    
    # Calculate baseline offset
    if np.any(mask_base):
        offset_l = np.mean(l_raw_inverted[mask_base])
    else:
        offset_l = 0.0
        
    l_corrected = l_raw_inverted - offset_l

    # Normalization
    norm_factor = 1.0
    if norm_start_ns is not None and norm_end_ns is not None:
        mask_norm = (t_ns >= norm_start_ns) & (t_ns <= norm_end_ns)
        if np.any(mask_norm):
            norm_factor = np.mean(l_corrected[mask_norm])
        else:
            norm_factor = np.max(l_corrected) if len(l_corrected) > 0 else 1e-10
    else:
        norm_factor = np.max(l_corrected) if len(l_corrected) > 0 else 1e-10
        
    if norm_factor == 0: norm_factor = 1e-10
    l_norm = l_corrected / norm_factor

    # 2. CH2 (Current): V -> I -> J
    # V_ch2 -> I_led = V_ch2 / R_total
    # J = I_led / Area
    offset_ch2 = 0.0
    if np.any(mask_base):
        offset_ch2 = np.mean(ch2[mask_base])
        
    j_raw = ((ch2 - offset_ch2) / R_TOTAL) / AREA_CM2 * 1000.0

    # 3. Time Shift Calculation
    # Trigger (t=0) is Voltage ON.
    # We want Shifted Time t=0 to be Voltage OFF (Decay Start).
    shift_offset_us = 0.0
    if frequency_hz and frequency_hz > 0:
        period_us = (1.0 / frequency_hz) * 1e6
        t_on_us = period_us * duty_fraction
        shift_offset_us = t_on_us
    else:
        # Fallback: Max luminance index
        imax = np.argmax(l_norm)
        shift_offset_us = t_ms[imax] * 1000.0

    # 결과 DataFrame 생성
    time_us = t_ms * 1000.0
    shifted_us = time_us - shift_offset_us

    out_df = pd.DataFrame({
        'Time (μs)': time_us,
        'Shifted Time (μs)': shifted_us,
        'Normalized intensity (a.u.)': l_norm,
        'Current density (mA cm⁻²)': j_raw
    })
    
    # 출력 CSV 생성
    output = io.StringIO()
    # 빈 줄 2개 추가 (기존 포맷 유지)
    output.write('Time (μs),Shifted Time (μs),Normalized intensity (a.u.),Current density (mA cm⁻²)\n\n\n')
    # DataFrame 데이터만 쓰기 (헤더 제외)
    out_df.to_csv(output, index=False, header=False, float_format='%.6f')

    base = filename.replace('.csv', '') if filename else 'output'
    output_filename = f"{base}_TrEL.csv"

    metadata = {
        'filename': filename,
        'output_filename': output_filename,
        'original_points': len(df),
        'baseline_start_ns': baseline_start_ns,
        'baseline_end_ns': baseline_end_ns,
        'norm_start_ns': norm_start_ns,
        'norm_end_ns': norm_end_ns,
        'frequency_hz': frequency_hz,
        'duty_fraction': duty_fraction,
        'r_total_ohm': R_TOTAL,
        'area_cm2': AREA_CM2
    }

    return output.getvalue(), metadata


def _parse_osc_csv_legacy(content: str) -> List[Tuple[float, float, float, float]]:
    """
    오실로스코프 CSV 파싱 (Legacy Pure Python Version)
    - 미리보기용으로 사용
    - Returns: list of (time_ms, CH1, CH2, CH4) tuples
    """
    lines = content.splitlines()
    if len(lines) < 2:
        return [] # Return empty instead of raising

    # 1. Header Search
    header_row = -1
    headers = []
    
    for i, line in enumerate(lines[:20]): # Check first 20 lines
        line_clean = line.lower().replace('\ufeff', '').strip()
        if 'time' in line_clean and ',' in line_clean:
             header_row = i
             headers = [h.strip() for h in line_clean.split(',')]
             break
    
    if header_row == -1:
         return [] # Time column not found

    try:
        time_idx = next(i for i, h in enumerate(headers) if 'time' in h)
        # Relaxed matching for CH1/CH2 (e.g. "Channel 1", "CH1", "Volt")
        ch1_idx = next((i for i, h in enumerate(headers) if 'ch1' in h or 'channel 1' in h), -1)
        ch2_idx = next((i for i, h in enumerate(headers) if 'ch2' in h or 'channel 2' in h), -1)
        ch4_idx = next((i for i, h in enumerate(headers) if 'ch4' in h or 'channel 4' in h), -1)

        if ch1_idx == -1 or ch2_idx == -1:
             return [] # Missing essential columns

    except StopIteration:
        return []

    # 2. Data Parsing
    data = []
    start_idx = header_row + 1
    
    # Check for unit row
    if len(lines) > start_idx:
        first_line = lines[start_idx]
        first_val = first_line.split(',')[time_idx].strip()
        # If not a number, skip unit row
        if not re.match(r'^-?\d+(\.\d+)?([eE][+-]?\d+)?$', first_val):
            start_idx += 1

    for line in lines[start_idx:]:
        if not line.strip(): continue
        parts = line.split(',')
        if len(parts) <= max(time_idx, ch1_idx, ch2_idx): continue
        
        try:
            t = float(parts[time_idx])
            c1 = float(parts[ch1_idx])
            c2 = float(parts[ch2_idx])
            c4 = float(parts[ch4_idx]) if ch4_idx != -1 and len(parts) > ch4_idx and parts[ch4_idx].strip() else 0.0
            data.append((t, c1, c2, c4))
        except ValueError:
            continue
            
    return data


def get_preview_data(csv_content: str, max_points: int = 2000) -> Dict:
    """
    미리보기용 데이터 추출 (CH1 Inverted, CH2 Raw) - Legacy Pure Python Version
    """
    try:
        data = _parse_osc_csv_legacy(csv_content)
        if not data:
            return {'error': 'CSV 파싱 실패 또는 데이터 없음'}

        # Unpack data
        t_ms_list = [row[0] for row in data]
        ch1_list = [-row[1] for row in data] # Invert CH1
        ch2_list = [row[2] for row in data]
        
        # Downsample
        n = len(t_ms_list)
        step = max(1, n // max_points)
        
        t_ns_preview = [t * 1e6 for t in t_ms_list[::step]]
        ch1_preview = ch1_list[::step]
        ch2_preview = ch2_list[::step]
        
        return {
            'time_ns': t_ns_preview,
            'ch1': ch1_preview,
            'ch2': ch2_preview,
            'n_points': n
        }

    except Exception as e:
         return {'error': str(e)}
