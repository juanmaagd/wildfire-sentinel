import { useCallback, useReducer, useRef, useState } from 'react'
import { initialState, reducer } from './state'
import type { Mode } from './types'

const MOCK = new URLSearchParams(location.search).get('mock') === '1'
const EVENTS = ['day', 'hotspot', 'triage', 'probe', 'report', 'summary', 'analysis_error'] as const

export function useRun() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const runRef = useRef(0)
  const esRef = useRef<EventSource | null>(null)
  const timerRef = useRef<number | null>(null)
  const startedRef = useRef(0)
  const frozenRef = useRef(false)
  // Pause: incoming events are buffered (the backend keeps streaming) and the clock stops; resume replays them paced.
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const pausedAtRef = useRef(0)
  const bufferRef = useRef<{ runId: number; name: string; data: unknown }[]>([])

  const now = () => (performance.now() - startedRef.current) / 1000

  const stopTimer = () => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const closeStream = () => {
    esRef.current?.close()
    esRef.current = null
  }

  const finish = useCallback((status: 'done' | 'error', text: string) => {
    closeStream()
    stopTimer()
    dispatch({ type: 'status', status, text, at: now() })
  }, [])

  const handle = (runId: number, name: string, data: unknown) => {
    if (runId !== runRef.current) return
    if (pausedRef.current) {
      bufferRef.current.push({ runId, name, data })
      return
    }
    if (name === 'summary') frozenRef.current = true
    dispatch({ type: 'event', name, data, at: now() })
    if (name === 'done') finish('done', 'Run complete')
  }

  const start = useCallback((mode: Mode, bbox?: string) => {
    runRef.current += 1
    const runId = runRef.current
    closeStream()
    stopTimer()
    startedRef.current = performance.now()
    frozenRef.current = false
    pausedRef.current = false
    setPaused(false)
    bufferRef.current = []
    dispatch({ type: 'start', runId, mode, at: 0 })
    timerRef.current = window.setInterval(() => {
      if (!frozenRef.current && !pausedRef.current && runId === runRef.current) dispatch({ type: 'tick', elapsed: now() })
    }, 100)

    if (MOCK) {
      void runMock(runId)
      return
    }

    const es = new EventSource(`/api/run?mode=${encodeURIComponent(mode)}${bbox ? `&bbox=${bbox}` : ''}`)
    esRef.current = es
    for (const name of EVENTS) {
      es.addEventListener(name, (e) => {
        let data: unknown = {}
        try {
          data = (e as MessageEvent).data ? JSON.parse((e as MessageEvent).data) : {}
        } catch {
          dispatch({ type: 'feed', text: `Bad ${name} payload`, kind: 'err', at: now() })
          return
        }
        handle(runId, name, data)
      })
    }
    es.addEventListener('done', () => handle(runId, 'done', {}))
    // Server-sent "error" events carry data; connection failures do not.
    // Never let EventSource auto-reconnect: that would start a new run.
    es.addEventListener('error', (e) => {
      const data = (e as MessageEvent).data
      if (data) {
        dispatch({ type: 'feed', text: `Server error: ${String(data)}`, kind: 'err', at: now() })
        return
      }
      if (esRef.current !== es) return
      finish('error', 'Stream closed — backend unreachable or run ended without "done"')
      dispatch({ type: 'feed', text: 'Stream closed unexpectedly', kind: 'err', at: now() })
    })
  }, [finish])

  async function runMock(runId: number) {
    let events: { event: string; data: unknown }[]
    try {
      const res = await fetch('/mock-events.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      events = await res.json()
    } catch (err) {
      if (runId !== runRef.current) return
      finish('error', 'Could not load mock-events.json')
      dispatch({ type: 'feed', text: `Mock load failed: ${(err as Error).message}`, kind: 'err', at: now() })
      return
    }
    for (const ev of events) {
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 250))
      if (runId !== runRef.current) return
      handle(runId, ev.event, ev.data)
    }
  }

  const togglePause = useCallback(() => {
    if (!pausedRef.current) {
      pausedRef.current = true
      pausedAtRef.current = performance.now()
      setPaused(true)
      return
    }
    pausedRef.current = false
    startedRef.current += performance.now() - pausedAtRef.current // paused time doesn't count as elapsed
    setPaused(false)
    const drain = () => {
      if (pausedRef.current) return
      const next = bufferRef.current.shift()
      if (!next) return
      handle(next.runId, next.name, next.data)
      window.setTimeout(drain, 40)
    }
    drain()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), [])
  const setLang = useCallback((lang: 'en' | 'ja') => {
    try {
      localStorage.setItem('ws-lang', lang)
    } catch {
      /* ignore */
    }
    dispatch({ type: 'lang', lang })
  }, [])

  // Feed out-of-stream payloads (e.g. an on-demand ai& report) through the same reducer.
  const ingest = useCallback((name: string, data: unknown) => dispatch({ type: 'event', name, data, at: now() }), [])
  return { state, start, select, setLang, ingest, paused, togglePause, isMock: MOCK }
}
