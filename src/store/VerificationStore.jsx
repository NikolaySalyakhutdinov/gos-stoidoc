import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { apiBaseUrl, apiFetch, getToken } from '../api/client'
import { useAuth } from './AuthStore'

const Ctx = createContext(null)
const EMPTY_UPLOADS = { PD: [], RD: [], ID: [] }

export function VerificationProvider({ children }) {
  const { isAuthenticated } = useAuth()

  const [objects, setObjects] = useState([])
  const [objectsLoaded, setObjectsLoaded] = useState(false)
  const [findingsByObject, setFindingsByObject] = useState({})
  const [completenessByObject, setCompletenessByObject] = useState({})
  const [uploadsByObject, setUploadsByObject] = useState({})
  const [auditEvents, setAuditEvents] = useState(null)

  const pending = useRef(new Set())

  useEffect(() => {
    setObjects([])
    setObjectsLoaded(false)
    setFindingsByObject({})
    setCompletenessByObject({})
    setUploadsByObject({})
    setAuditEvents(null)
    pending.current.clear()
  }, [isAuthenticated])

  async function withGuard(key, fn) {
    if (pending.current.has(key)) return
    pending.current.add(key)
    try {
      await fn()
    } finally {
      pending.current.delete(key)
    }
  }

  async function refreshObjects() {
    if (!isAuthenticated) return
    const data = await apiFetch('/api/objects')
    setObjects(data.objects)
    setObjectsLoaded(true)
  }

  async function refreshObject(objectId) {
    if (!isAuthenticated) return null
    const data = await apiFetch(`/api/objects/${objectId}`)
    setObjects((list) => {
      const exists = list.some((object) => object.id === objectId)
      return exists ? list.map((object) => (object.id === objectId ? data.object : object)) : [data.object, ...list]
    })
    if (findingsByObject[objectId]) {
      const findings = await apiFetch(`/api/objects/${objectId}/findings`)
      setFindingsByObject((state) => ({ ...state, [objectId]: findings.findings }))
    }
    if (completenessByObject[objectId]) {
      const completeness = await apiFetch(`/api/objects/${objectId}/completeness`)
      setCompletenessByObject((state) => ({ ...state, [objectId]: completeness.completeness }))
    }
    return data.object
  }

  const api = useMemo(
    () => ({
      objects,
      objectsLoaded,

      ensureObjects() {
        if (!isAuthenticated || objectsLoaded) return
        withGuard('objects', refreshObjects)
      },

      refreshObject,

      subscribeToProgress(objectId) {
        if (!isAuthenticated || typeof fetch !== 'function' || typeof AbortController === 'undefined') return () => {}
        const token = getToken()
        if (!token) return () => {}

        const controller = new AbortController()
        let stopped = false

        const onProgress = (payload) => {
          try {
            setObjects((list) => list.map((object) => (
              object.id === objectId
                ? {
                    ...object,
                    process_status: payload.process_status ?? object.process_status,
                    process_step: payload.process_step ?? object.process_step,
                    process_progress: payload.process_progress ?? object.process_progress,
                    process_error: payload.process_error ?? null,
                  }
                : object
            )))
            if (['READY', 'FAILED'].includes(payload.process_status)) {
              refreshObject(objectId).catch(() => {})
            }
          } catch {
            // Ignore malformed stream events; polling remains the fallback.
          }
        }

        const consume = async () => {
          try {
            const response = await fetch(`${apiBaseUrl()}/api/objects/${encodeURIComponent(objectId)}/events`, {
              headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
              signal: controller.signal,
            })
            if (!response.ok || !response.body) return

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            while (!stopped) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const events = buffer.split(/\r?\n\r?\n/)
              buffer = events.pop() || ''
              events.forEach((event) => {
                const dataLine = event.split(/\r?\n/).find((line) => line.startsWith('data:'))
                if (!dataLine) return
                try {
                  onProgress(JSON.parse(dataLine.slice(5).trim()))
                } catch {
                  // Ignore malformed stream events; polling remains the fallback.
                }
              })
            }
          } catch {
            // Polling remains active when the live stream is unavailable.
          }
        }
        consume()

        return () => {
          stopped = true
          controller.abort()
        }
      },

      getObject(objectId) {
        return objects.find((o) => o.id === objectId)
      },

      async createObject(payload) {
        const data = await apiFetch('/api/objects', { method: 'POST', body: payload })
        setObjects((list) => [data.object, ...list])
        setObjectsLoaded(true)
        setAuditEvents(null)
        return data.object
      },

      ensureFindings(objectId) {
        if (!isAuthenticated || findingsByObject[objectId]) return
        withGuard(`findings:${objectId}`, async () => {
          const data = await apiFetch(`/api/objects/${objectId}/findings`)
          setFindingsByObject((s) => ({ ...s, [objectId]: data.findings }))
        })
      },

      getFindings(objectId) {
        return findingsByObject[objectId] || []
      },

      getFinding(objectId, findingId) {
        return (findingsByObject[objectId] || []).find((f) => f.finding_id === findingId)
      },

      ensureCompleteness(objectId) {
        if (!isAuthenticated || completenessByObject[objectId]) return
        withGuard(`completeness:${objectId}`, async () => {
          const data = await apiFetch(`/api/objects/${objectId}/completeness`)
          setCompletenessByObject((s) => ({ ...s, [objectId]: data.completeness }))
        })
      },

      getCompleteness(objectId) {
        return completenessByObject[objectId] || []
      },

      ensureUploads(objectId) {
        if (!isAuthenticated || uploadsByObject[objectId]) return
        withGuard(`uploads:${objectId}`, async () => {
          const data = await apiFetch(`/api/objects/${objectId}/uploads`)
          setUploadsByObject((s) => ({ ...s, [objectId]: data.uploads }))
        })
      },

      getUploads(objectId) {
        return uploadsByObject[objectId] || EMPTY_UPLOADS
      },

      async addFiles(objectId, stage, files) {
        const form = new FormData()
        files.forEach((file) => form.append('files', file))
        const data = await apiFetch(`/api/objects/${objectId}/uploads/${stage}`, {
          method: 'POST',
          body: form,
        })
        setUploadsByObject((s) => {
          const current = s[objectId] || EMPTY_UPLOADS
          return { ...s, [objectId]: { ...current, [stage]: [...current[stage], ...data.uploaded] } }
        })
        await refreshObjects()
      },

      async deleteObject(objectId, deletion) {
        await apiFetch(`/api/objects/${objectId}`, { method: 'DELETE', body: deletion })
        setObjects((list) => list.filter((object) => object.id !== objectId))
        setFindingsByObject((state) => {
          const next = { ...state }
          delete next[objectId]
          return next
        })
        setCompletenessByObject((state) => {
          const next = { ...state }
          delete next[objectId]
          return next
        })
        setUploadsByObject((state) => {
          const next = { ...state }
          delete next[objectId]
          return next
        })
        setAuditEvents(null)
      },

      async removeFile(objectId, stage, fileId) {
        await apiFetch(`/api/objects/${objectId}/uploads/${stage}/${fileId}`, { method: 'DELETE' })
        setUploadsByObject((s) => {
          const current = s[objectId] || EMPTY_UPLOADS
          return { ...s, [objectId]: { ...current, [stage]: current[stage].filter((f) => f.id !== fileId) } }
        })
        await refreshObject(objectId)
      },

      getEffectiveDocStatus(objectId, stage) {
        const obj = objects.find((o) => o.id === objectId)
        if (!obj) return 'MISSING'
        const stageUploads = uploadsByObject[objectId]?.[stage]
        if (stageUploads) return stageUploads.length > 0 ? 'UPLOADED' : 'MISSING'
        return { PD: obj.pd_status, RD: obj.rd_status, ID: obj.id_status }[stage]
      },

      getProcessStatus(objectId) {
        return objects.find((o) => o.id === objectId)?.process_status
      },

      async setProcessStatus(objectId, status) {
        const data = await apiFetch(`/api/objects/${objectId}/status`, { method: 'PATCH', body: { status } })
        setObjects((list) => list.map((o) => (o.id === objectId ? data.object : o)))
      },

      async finalizeProtocol(objectId) {
        await api.setProcessStatus(objectId, 'FINALIZED')
        setAuditEvents(null)
      },

      async reopenProtocol(objectId) {
        await api.setProcessStatus(objectId, 'COMPLETED')
      },

      async decide(objectId, findingId, { status, reason_code, comment }) {
        const data = await apiFetch(`/api/objects/${objectId}/findings/${findingId}/decide`, {
          method: 'POST',
          body: { status, reason_code, comment },
        })
        setFindingsByObject((s) => ({
          ...s,
          [objectId]: (s[objectId] || []).map((f) => (f.finding_id === findingId ? data.finding : f)),
        }))
        setAuditEvents(null)
        await refreshObjects()
      },

      async undo(objectId, findingId) {
        const data = await apiFetch(`/api/objects/${objectId}/findings/${findingId}/undo`, { method: 'POST' })
        setFindingsByObject((s) => ({
          ...s,
          [objectId]: (s[objectId] || []).map((f) => (f.finding_id === findingId ? data.finding : f)),
        }))
        setAuditEvents(null)
        await refreshObjects()
      },

      ensureAudit() {
        if (!isAuthenticated || auditEvents) return
        withGuard('audit', async () => {
          const data = await apiFetch('/api/audit')
          setAuditEvents(data.events)
        })
      },

      getAudit() {
        return auditEvents || []
      },
    }),
    [objects, objectsLoaded, findingsByObject, completenessByObject, uploadsByObject, auditEvents, isAuthenticated]
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useVerification() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useVerification must be used within VerificationProvider')
  return ctx
}
