import { EventEmitter } from 'node:events'

const progressBus = new EventEmitter()
progressBus.setMaxListeners(0)

function eventName(objectId) {
  return `object:${objectId}`
}

export function publishProgress(objectId, payload) {
  progressBus.emit(eventName(objectId), {
    type: 'progress',
    object_id: objectId,
    ...payload,
    at: new Date().toISOString(),
  })
}

export function subscribeProgress(objectId, listener) {
  const name = eventName(objectId)
  progressBus.on(name, listener)
  return () => progressBus.off(name, listener)
}
