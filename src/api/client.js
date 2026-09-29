const BASE_URL = import.meta.env.VITE_API_URL || ''
const TOKEN_KEY = 'stroynadzor-token-v1'
const REFRESH_TOKEN_KEY = 'stroynadzor-refresh-token-v1'

let refreshPromise = null

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getRefreshToken() {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export function setRefreshToken(token) {
  try {
    if (token) localStorage.setItem(REFRESH_TOKEN_KEY, token)
    else localStorage.removeItem(REFRESH_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export function setSession({ token, refreshToken }) {
  setToken(token)
  if (refreshToken) setRefreshToken(refreshToken)
}

export function clearSession() {
  setToken(null)
  setRefreshToken(null)
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function request(path, options = {}) {
  const { skipRefresh: _skipRefresh, ...fetchOptions } = options
  const token = getToken()
  const headers = { ...(fetchOptions.headers || {}) }
  const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData

  if (fetchOptions.body !== undefined && !isFormData) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) headers.Authorization = 'Bearer ' + token

  const res = await fetch(BASE_URL + path, {
    ...fetchOptions,
    headers,
    body: fetchOptions.body !== undefined
      ? (isFormData ? fetchOptions.body : JSON.stringify(fetchOptions.body))
      : undefined,
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }

  return { res, data }
}

async function requestBlob(path, options = {}) {
  const { skipRefresh: _skipRefresh, ...fetchOptions } = options
  const token = getToken()
  const headers = { ...(fetchOptions.headers || {}) }
  if (token) headers.Authorization = 'Bearer ' + token

  const res = await fetch(BASE_URL + path, {
    ...fetchOptions,
    headers,
  })

  return { res }
}

export async function refreshSession() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    throw new ApiError('Refresh-токен отсутствует', 401)
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const { res, data } = await request('/api/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        skipRefresh: true,
      })

      if (!res.ok || !data?.token) {
        throw new ApiError(data?.error || 'Ошибка обновления сессии (' + res.status + ')', res.status)
      }

      setSession(data)
      return data
    })().finally(() => {
      refreshPromise = null
    })
  }

  return refreshPromise
}

function notifyAuthExpired() {
  clearSession()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('auth:expired'))
  }
}

export async function apiFetch(path, options = {}) {
  let result = await request(path, options)

  if (result.res.status === 401 && path !== '/api/auth/refresh' && !options.skipRefresh) {
    try {
      await refreshSession()
      result = await request(path, options)
    } catch {
      notifyAuthExpired()
    }
  }

  if (!result.res.ok) {
    throw new ApiError(result.data?.error || 'Ошибка запроса (' + result.res.status + ')', result.res.status)
  }

  return result.data
}

export async function apiFetchBlob(path, options = {}) {
  let result = await requestBlob(path, options)

  if (result.res.status === 401 && path !== '/api/auth/refresh' && !options.skipRefresh) {
    try {
      await refreshSession()
      result = await requestBlob(path, options)
    } catch {
      notifyAuthExpired()
    }
  }

  if (!result.res.ok) {
    let data = null
    try {
      data = await result.res.clone().json()
    } catch {
      /* response is not JSON */
    }
    throw new ApiError(data?.error || 'Ошибка загрузки файла (' + result.res.status + ')', result.res.status)
  }

  return result.res.blob()
}
