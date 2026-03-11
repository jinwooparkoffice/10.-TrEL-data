import React, { useState, useEffect, useMemo, useRef } from 'react'

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || `${window.location.protocol}//${window.location.hostname}:8080`
const apiUrl = (path) => `${API_ORIGIN}${path}`

function RisePreviewChart({ timeRaw, elSignal, tDelay, tSaturation }) {
  const w = 650
  const h = 260
  const pad = { top: 20, right: 20, bottom: 40, left: 55 }
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom

    const { pathOrig, xScale, yScale, xTicks } = useMemo(() => {
    try {
      if (!timeRaw?.length || !elSignal?.length) return {}
      
      // 로그 스케일: t > 0 인 데이터만 사용
      const filtered = timeRaw
        .map((t, i) => ({ t, y: elSignal[i] }))
        .filter(({ t, y }) => t > 0 && Number.isFinite(t) && Number.isFinite(y))
        .sort((a, b) => a.t - b.t)
        
      if (filtered.length === 0) return {}
      
      // X축: Log Scale (0.1 ~ 100 μs 고정 또는 데이터 범위)
      // 데이터가 이미 100us 이하로 잘려서 옴
      const tVals = filtered.map(({ t }) => t)
      const xMinVal = Math.min(...tVals)
      const xMaxVal = Math.max(...tVals)
      
      // 로그 스케일 범위 설정 (최소 0.1us 부터 100us)
      // Math.log10(0) = -Infinity, Math.log10(Infinity) = Infinity 방지
      const logMin = Math.log10(Math.max(xMinVal, 0.1)) 
      const logMax = Math.log10(Math.max(xMaxVal, 10)) 
      
      if (!Number.isFinite(logMin) || !Number.isFinite(logMax)) return {}

      const logRange = logMax - logMin || 1
      
      const yVals = filtered.map(({ y }) => y)
      
      // Y축 범위 안전 설정 (유효한 값만)
      const validY = yVals.filter(y => Number.isFinite(y))
      const yMin = validY.length ? Math.min(...validY) : 0
      const yMax = validY.length ? Math.max(...validY) : 1
      const yRange = yMax - yMin || 1
      
      const xScale = v => {
        if (v == null || !Number.isFinite(v) || v <= 0) return pad.left
        const logV = Math.log10(v)
        if (!Number.isFinite(logV)) return pad.left
        if (logV < logMin) return pad.left 
        if (logV > logMax) return pad.left + plotW
        return pad.left + ((logV - logMin) / logRange) * plotW
      }
      
      const yScale = v => {
         if (v == null || !Number.isFinite(v)) return pad.top + plotH
         return pad.top + plotH - ((v - yMin) / yRange) * plotH
      }

      // 유효성 검사 추가: 좌표가 NaN이면 안됨
      const ptsOrig = filtered
        .map(({ t, y }) => {
          const x = xScale(t)
          const yCoord = yScale(y)
          if (!Number.isFinite(x) || !Number.isFinite(yCoord)) return null
          return `${x},${yCoord}`
        })
        .filter(pt => pt !== null)
        .join(' L ')
        
      const pathOrig = ptsOrig ? `M ${ptsOrig}` : ''
      
      // 로그 눈금: 0.1, 1, 10, 100
      const xTicks = []
      let p = Math.floor(logMin)
      let safety = 0
      const endP = Math.ceil(logMax)
      
      while (p <= endP && safety < 100) {
        const val = Math.pow(10, p)
        if (val >= Math.pow(10, logMin) && val <= Math.pow(10, logMax)) {
           xTicks.push(val)
        }
        p += 1
        safety++
      }
      
      return { pathOrig, xScale, yScale, xTicks }
    } catch (e) {
      console.error('Rise Chart Error:', e)
      return {}
    }
  }, [timeRaw, elSignal])

  if (!pathOrig) return (
    <div style={{ height: h, background: '#f5f5f5', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
      데이터 없음
    </div>
  )

  return (
    <svg width={w} height={h} style={{ display: 'block', background: '#fff', borderRadius: 6, border: '1px solid #ddd' }}>
      <path d={pathOrig} fill="none" stroke="#2196f3" strokeWidth={1.5} strokeLinejoin="round" opacity={0.9} />
      {tDelay != null && xScale && (
        <line x1={xScale(tDelay)} y1={pad.top} x2={xScale(tDelay)} y2={pad.top + plotH} stroke="#4caf50" strokeWidth={1} strokeDasharray="2,2" />
      )}
      {tSaturation != null && xScale && (
        <line x1={xScale(tSaturation)} y1={pad.top} x2={xScale(tSaturation)} y2={pad.top + plotH} stroke="#ff9800" strokeWidth={1} strokeDasharray="2,2" />
      )}
      {xTicks?.map((v, i) => (
        <g key={`tick-${i}-${v}`}>
          <line x1={xScale(v)} y1={pad.top + plotH} x2={xScale(v)} y2={pad.top + plotH + 4} stroke="#333" strokeWidth={1} />
          <text x={xScale(v)} y={h - 8} fontSize={9} fill="#333" textAnchor="middle">
            {v >= 1 ? v : v.toExponential(0)}
          </text>
        </g>
      ))}
      <text x={pad.left} y={h - 10} fontSize={11} fill="#666">Time (μs), Log (0.1~100μs)</text>
      <text x={w - 100} y={pad.top + 14} fontSize={10} fill="#4caf50">| t_delay</text>
      <text x={w - 100} y={pad.top + 28} fontSize={10} fill="#ff9800">| t_saturation</text>
    </svg>
  )
}

function DecayPreviewChart({ timeDecay, elSignalLog, tDecayFit, yFitLog }) {
  const w = 650
  const h = 260
  const pad = { top: 20, right: 20, bottom: 40, left: 55 }
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom

  const { pathOrig, pathFit, xScale, yScale } = useMemo(() => {
    try {
      if (!timeDecay?.length || !elSignalLog?.length) return {}
      
      // 유효한 데이터만 필터링 (null, NaN, Infinity 제외)
      // 원본 데이터
      const validPoints = []
      for (let i = 0; i < timeDecay.length; i++) {
        const t = timeDecay[i]
        const v = elSignalLog[i]
        if (t != null && v != null && Number.isFinite(t) && Number.isFinite(v)) {
          validPoints.push({ t, v })
        }
      }
      
      if (validPoints.length === 0) return {}

      const xMin = Math.min(...validPoints.map(p => p.t))
      const xMax = Math.max(...validPoints.map(p => p.t))
      const yMin = Math.min(...validPoints.map(p => p.v))
      const yMax = Math.max(...validPoints.map(p => p.v))
      
      const yRange = yMax - yMin || 1
      const xScale = v => {
         if (v == null || !Number.isFinite(v)) return pad.left
         return pad.left + ((v - xMin) / (xMax - xMin || 1)) * plotW
      }
      const yScale = v => {
         if (v == null || !Number.isFinite(v)) return pad.top + plotH
         return pad.top + plotH - ((v - yMin) / yRange) * plotH
      }
      
      const ptsOrig = validPoints
        .map(p => {
          const x = xScale(p.t)
          const y = yScale(p.v)
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null
          return `${x},${y}`
        })
        .filter(pt => pt !== null)
        .join(' L ')
        
      const pathOrig = ptsOrig ? `M ${ptsOrig}` : ''
      
      let pathFit = ''
      if (tDecayFit?.length && yFitLog?.length) {
        // 피팅 데이터도 필터링
        const validFit = []
        for (let i = 0; i < tDecayFit.length; i++) {
          const t = tDecayFit[i]
          const v = yFitLog[i]
          if (t != null && v != null && Number.isFinite(t) && Number.isFinite(v)) {
            validFit.push({ t, v })
          }
        }
        
        if (validFit.length > 0) {
          const ptsFit = validFit
            .map(p => {
              const x = xScale(p.t)
              const y = yScale(p.v)
              if (!Number.isFinite(x) || !Number.isFinite(y)) return null
              return `${x},${y}`
            })
            .filter(pt => pt !== null)
            .join(' L ')
          pathFit = ptsFit ? `M ${ptsFit}` : ''
        }
      }
      return { pathOrig, pathFit, xScale, yScale }
    } catch (e) {
      console.error('Decay Chart Error:', e)
      return {}
    }
  }, [timeDecay, elSignalLog, tDecayFit, yFitLog])

  if (!pathOrig) return (
    <div style={{ height: h, background: '#f5f5f5', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
      데이터 없음
    </div>
  )

  return (
    <svg width={w} height={h} style={{ display: 'block', background: '#fff', borderRadius: 6, border: '1px solid #ddd' }}>
      <path d={pathOrig} fill="none" stroke="#2196f3" strokeWidth={1.5} strokeLinejoin="round" opacity={0.9} />
      {pathFit && <path d={pathFit} fill="none" stroke="#e91e63" strokeWidth={1.5} strokeDasharray="4,2" strokeLinejoin="round" />}
      <text x={pad.left} y={h - 10} fontSize={11} fill="#666">Time_Decay (μs)</text>
      <text x={pad.left} y={pad.top - 8} fontSize={10} fill="#666">Y: Log scale</text>
      <text x={w - 100} y={pad.top + 14} fontSize={10} fill="#2196f3">— 원본</text>
      <text x={w - 100} y={pad.top + 28} fontSize={10} fill="#e91e63">— 피팅</text>
    </svg>
  )
}

export default function AnalysisTab({ backendStatus }) {
  const [analysisFolderReady, setAnalysisFolderReady] = useState(false)
  const [analysisFiles, setAnalysisFiles] = useState([])
  const [analysisVilFiles, setAnalysisVilFiles] = useState([])
  const [analysisDirHandle, setAnalysisDirHandle] = useState(null)
  const [lowPct, setLowPct] = useState(0.1)
  const [highPct, setHighPct] = useState(99)
  const [nDecay, setNDecay] = useState(2)
  const [decayFitStartUs, setDecayFitStartUs] = useState(4)
  const [integrationLimitUs, setIntegrationLimitUs] = useState(5)
  const [baselineStartUs, setBaselineStartUs] = useState(20)
  const [previewSubTab, setPreviewSubTab] = useState('rise')  // 'rise' | 'decay'
  const [analysisPreview, setAnalysisPreview] = useState(null)
  const [analysisError, setAnalysisError] = useState(null)
  const [analysisProcessing, setAnalysisProcessing] = useState(false)
  const [analysisDone, setAnalysisDone] = useState(false)
  const analysisAbortRef = useRef(null)

  const collectFiles = async (dir, prefix, filter) => {
    const list = []
    for await (const [name, handle] of dir.entries()) {
      const relPath = prefix ? `${prefix}/${name}` : name
      if (handle.kind === 'file' && filter(name)) {
        list.push({ name, relPath, file: await handle.getFile() })
      } else if (handle.kind === 'directory') {
        list.push(...await collectFiles(handle, relPath, filter))
      }
    }
    return list
  }

  const handleAnalysisFolderSelect = async () => {
    if (!('showDirectoryPicker' in window)) {
      setAnalysisError('이 브라우저는 폴더 선택을 지원하지 않습니다.')
      return
    }
    setAnalysisError(null)
    setAnalysisPreview(null)
    setAnalysisDone(false)
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
      const files = await collectFiles(dirHandle, '', n =>
        !n.startsWith('._') && n.endsWith('.csv') && (n.includes('_TrEL') || n.includes('TrEL'))
      )
      const vilFiles = await collectFiles(dirHandle, '', n =>
        !n.startsWith('._') &&
        (n.endsWith('.csv') || n.endsWith('.xlsx')) &&
        n.toUpperCase().includes('VIL') &&
        n.includes('_processed')
      )
      if (files.length === 0) {
        setAnalysisError('TrEL 형식 CSV 파일이 없습니다. (_TrEL.csv 또는 TrEL_processed 내 파일)')
        setAnalysisFolderReady(false)
        return
      }
      setAnalysisFiles(files)
      setAnalysisVilFiles(vilFiles)
      setAnalysisDirHandle(dirHandle)
      setAnalysisFolderReady(true)
      const fd = new FormData()
      fd.append('file', files[0].file)
      fd.append('low_pct', lowPct)
      fd.append('high_pct', highPct)
      fd.append('n_decay', nDecay)
      fd.append('decay_fit_start_us', decayFitStartUs)
      const res = await fetch(apiUrl('/api/trel-analysis-preview'), { method: 'POST', body: fd })
      const data = await res.json()
      if (data.success) {
        setAnalysisPreview(data)
      } else {
        setAnalysisPreview(null)
        setAnalysisError(data.error || '미리보기 로드 실패')
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      setAnalysisError(err.message === 'Failed to fetch' ? '백엔드 연결 실패' : err.message)
      setAnalysisFolderReady(false)
    }
  }

  useEffect(() => {
    if (analysisFolderReady && analysisFiles.length > 0) {
      const fd = new FormData()
      fd.append('file', analysisFiles[0].file)
      fd.append('low_pct', lowPct)
      fd.append('high_pct', highPct)
      fd.append('n_decay', nDecay)
      fd.append('decay_fit_start_us', decayFitStartUs)
      fetch(apiUrl('/api/trel-analysis-preview'), { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
          if (data.success) setAnalysisPreview(data)
          else setAnalysisError(data.error || '미리보기 로드 실패')
        })
        .catch(err => setAnalysisError(err.message))
    }
  }, [lowPct, highPct, nDecay, decayFitStartUs, analysisFolderReady, analysisFiles])

  const handleAnalysisBatch = async () => {
    if (!analysisDirHandle || analysisFiles.length === 0) return
    setAnalysisError(null)
    setAnalysisProcessing(true)
    setAnalysisDone(false)
    const controller = new AbortController()
    analysisAbortRef.current = controller
    try {
      const fd = new FormData()
      analysisFiles.forEach(({ file }) => fd.append('files', file))
      analysisVilFiles.forEach(({ file }) => fd.append('vil_files', file))
      fd.append('low_pct', lowPct)
      fd.append('high_pct', highPct)
      fd.append('n_decay', nDecay)
      fd.append('decay_fit_start_us', decayFitStartUs)
      fd.append('integration_limit_us', integrationLimitUs)
      fd.append('baseline_start_us', baselineStartUs)
      const res = await fetch(apiUrl('/api/trel-analysis-batch'), { method: 'POST', body: fd, signal: controller.signal })
      const ct = res.headers.get('content-type') || ''
      if (ct.includes('json')) {
        const data = await res.json()
        throw new Error(data.error || '분석 실패')
      }
      const blob = await res.blob()
      const fh = await analysisDirHandle.getFileHandle('TrEL_Analysis.xlsx', { create: true })
      const w = await fh.createWritable()
      await w.write(blob)
      await w.close()
      setAnalysisDone(true)
    } catch (err) {
      if (err.name === 'AbortError') {
        setAnalysisError('사용자가 중단했습니다.')
        return
      }
      setAnalysisError(err.message === 'Failed to fetch' ? '백엔드 연결 실패' : err.message)
    } finally {
      setAnalysisProcessing(false)
      analysisAbortRef.current = null
    }
  }

  return (
    <div style={{ marginTop: '20px' }}>
      <h2>TrEL 자동 배치 분석</h2>
      <p style={{ color: '#666', marginBottom: '20px' }}>
        TrEL_processed 폴더 내 CSV에서 Rise, Saturation, Decay 파라미터를 추출하여 Excel로 저장합니다.
      </p>

      {backendStatus?.status !== 'ok' && (
        <p style={{ color: '#d32f2f', marginBottom: '16px' }}>백엔드 연결 필요. pnpm dev:all로 실행해주세요.</p>
      )}

      <button
        className="simulate-button"
        onClick={handleAnalysisFolderSelect}
        disabled={backendStatus?.status !== 'ok'}
      >
        폴더 선택 (TrEL_processed)
      </button>

      {analysisFolderReady && analysisFiles.length > 0 && (
        <div style={{ marginTop: '20px', padding: '16px', background: '#fafafa', borderRadius: '6px', border: '1px solid #e0e0e0' }}>
          <p style={{ marginBottom: '16px', color: '#666' }}>
            총 {analysisFiles.length}개 TrEL CSV 파일
            {analysisVilFiles.length > 0 && <span style={{ marginLeft: '8px', color: '#1565c0' }}>· VIL_processed {analysisVilFiles.length}개 (Voltage 참조)</span>}
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', marginBottom: '20px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '4px' }}>Low% (절대값, 예: 1 → 0.01)</label>
              <input type="number" value={lowPct} onChange={e => setLowPct(Number(e.target.value))} step={0.5} min={0} max={100} style={{ width: '80px', padding: '6px 8px' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '4px' }}>High% (절대값, 예: 90 → 0.9)</label>
              <input type="number" value={highPct} onChange={e => setHighPct(Number(e.target.value))} step={0.5} min={0} max={100} style={{ width: '80px', padding: '6px 8px' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '4px' }}>Decay 지수 개수 (n)</label>
              <select value={nDecay} onChange={e => setNDecay(Number(e.target.value))} style={{ padding: '6px 8px' }}>
                {[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '4px' }}>Decay 피팅 시작 (μs)</label>
              <input
                type="number"
                value={decayFitStartUs}
                onChange={e => setDecayFitStartUs(Number(e.target.value))}
                step={0.1}
                min={0}
                max={50}
                style={{ width: '90px', padding: '6px 8px' }}
              />
              <span style={{ fontSize: '0.8em', color: '#666', marginLeft: '4px' }}>기본값 4</span>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '4px' }}>Rel. Capacitance 적분 구간 (μs)</label>
              <input type="number" value={integrationLimitUs} onChange={e => setIntegrationLimitUs(Number(e.target.value))} step={0.5} min={0.5} max={50} style={{ width: '80px', padding: '6px 8px' }} />
              <span style={{ fontSize: '0.8em', color: '#666', marginLeft: '4px' }}>t=0~적분 끝 (보통 2~5)</span>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '4px' }}>베이스라인 시작 (μs)</label>
              <input type="number" value={baselineStartUs} onChange={e => setBaselineStartUs(Number(e.target.value))} step={1} min={5} max={100} style={{ width: '80px', padding: '6px 8px' }} />
              <span style={{ fontSize: '0.8em', color: '#666', marginLeft: '4px' }}>t&gt;이 값 이후 평균</span>
            </div>
          </div>

          {analysisPreview && (
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ marginBottom: '8px' }}>미리보기: {analysisPreview.filename}</h4>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', borderBottom: '1px solid #ddd' }}>
                <button
                  type="button"
                  onClick={() => setPreviewSubTab('rise')}
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    background: previewSubTab === 'rise' ? '#e3f2fd' : 'transparent',
                    borderBottom: previewSubTab === 'rise' ? '2px solid #2196f3' : '2px solid transparent',
                    cursor: 'pointer',
                    fontSize: '0.9em',
                  }}
                >
                  Rise
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewSubTab('decay')}
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    background: previewSubTab === 'decay' ? '#e3f2fd' : 'transparent',
                    borderBottom: previewSubTab === 'decay' ? '2px solid #2196f3' : '2px solid transparent',
                    cursor: 'pointer',
                    fontSize: '0.9em',
                  }}
                >
                  Decay (Log)
                </button>
              </div>
              {previewSubTab === 'rise' && analysisPreview.rise && (
                <RisePreviewChart
                  timeRaw={analysisPreview.rise.time_raw}
                  elSignal={analysisPreview.rise.el_signal_rise}
                  tDelay={analysisPreview.rise.t_delay}
                  tSaturation={analysisPreview.rise.t_saturation}
                />
              )}
              {previewSubTab === 'decay' && analysisPreview.decay && (
                <DecayPreviewChart
                  timeDecay={analysisPreview.decay.time_decay}
                  elSignalLog={analysisPreview.decay.el_signal_decay_log}
                  tDecayFit={analysisPreview.decay.t_decay_fit}
                  yFitLog={analysisPreview.decay.y_fit_log}
                />
              )}
              {analysisPreview.tau_avg != null && (
                <p style={{ marginTop: '8px', fontSize: '0.9em', color: '#666' }}>
                  τ_avg = {Number.isFinite(analysisPreview.tau_avg) ? analysisPreview.tau_avg.toFixed(4) : '?'} μs
                  {analysisPreview.tau_list?.length > 0 && ` (${analysisPreview.tau_list.map((t, i) => `τ${i + 1}=${Number.isFinite(t) ? t.toFixed(4) : '?'}`).join(', ')})`}
                </p>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button
              className="simulate-button"
              onClick={handleAnalysisBatch}
              disabled={analysisProcessing || backendStatus?.status !== 'ok'}
            >
              {analysisProcessing ? '분석 중...' : '배치 분석 실행'}
            </button>
            {analysisProcessing && (
              <button
                type="button"
                onClick={() => analysisAbortRef.current?.abort()}
                style={{
                  padding: '10px 20px',
                  background: '#d32f2f',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                중단
              </button>
            )}
          </div>

          {analysisDone && <p style={{ marginTop: '12px', color: '#2e7d32', fontWeight: 600 }}>✓ TrEL_Analysis.xlsx 저장 완료</p>}
        </div>
      )}

      {analysisError && <div className="error-message" style={{ marginTop: '16px' }}>{analysisError}</div>}
    </div>
  )
}
