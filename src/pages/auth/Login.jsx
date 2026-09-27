import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthLayout from '../../components/AuthLayout'
import Icon from '../../components/Icon'
import { useAuth } from '../../store/AuthStore'

export default function Login() {
  const { signIn } = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const demoEmail = 'inspector@stroynadzor-ai.ru'
  const demoPassword = 'demo1234'

  const from = location.state?.from || '/'

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!email || !password) {
      setError('Заполните email и пароль')
      return
    }
    setLoading(true)
    try {
      const res = await signIn(email, password)
      if (!res.ok) {
        setError(res.error)
        return
      }
      nav(from, { replace: true })
    } finally {
      setLoading(false)
    }
  }

  function fillDemo() {
    setEmail(demoEmail)
    setPassword(demoPassword)
    setError('')
  }

  return (
    <AuthLayout
      title="Вход в платформу"
      subtitle="Введите рабочие учётные данные инспектора"
      footer={
        <>
          Нет аккаунта? <Link className="link-btn" to="/register">Создать аккаунт</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Email</label>
          <input
            className="input"
            style={{ width: '100%' }}
            type="email"
            autoComplete="username"
            placeholder="you@organization.ru"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label className="form-label">Пароль</label>
            <Link className="link-btn" style={{ fontSize: 12 }} to="/forgot-password">Забыли пароль?</Link>
          </div>
          <input
            className="input"
            style={{ width: '100%' }}
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Запомнить меня на этом устройстве
        </label>

        {error && <div className="form-error" role="alert"><Icon name="alert" size={13} /> {error}</div>}

        <button className="btn btn-primary btn-block" style={{ marginTop: 6 }} type="submit" disabled={loading}>
          {loading ? 'Проверка…' : 'Войти'}
        </button>

        <div className="auth-divider"><span>или</span></div>

        <button type="button" className="btn btn-block" onClick={fillDemo}>
          <Icon name="sparkle" size={14} /> Заполнить демо-доступ
        </button>
        <div className="hint" style={{ textAlign: 'center', marginTop: 8 }}>
          {demoEmail} / {demoPassword}
        </div>

      </form>
    </AuthLayout>
  )
}
