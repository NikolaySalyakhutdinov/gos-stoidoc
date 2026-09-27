import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../../components/AuthLayout'
import Icon from '../../components/Icon'
import { useAuth } from '../../store/AuthStore'
import { ROLE_LIST } from '../../data/roles'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Register() {
  const { signUp } = useAuth()
  const nav = useNavigate()

  const [form, setForm] = useState({
    name: '',
    email: '',
    org: 'Мосгосстройнадзор',
    role: 'INSPECTOR',
    password: '',
    confirm: '',
  })
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function validate() {
    if (!form.name.trim()) return 'Укажите имя и фамилию'
    if (!EMAIL_RE.test(form.email)) return 'Введите корректный email'
    if (!form.email.trim().toLowerCase().endsWith('.ru')) return 'Регистрация доступна только для email с доменом .ru'
    if (form.password.length < 6) return 'Пароль должен быть не короче 6 символов'
    if (form.password !== form.confirm) return 'Пароли не совпадают'
    if (!agree) return 'Подтвердите согласие на обработку персональных данных (152-ФЗ)'
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const err = validate()
    if (err) {
      setError(err)
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await signUp(form)
      if (!res.ok) {
        setError(res.error)
        return
      }
      nav('/', { replace: true })
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Создать аккаунт"
      subtitle="Регистрация нового пользователя платформы"
      footer={
        <>
          Уже есть аккаунт? <Link className="link-btn" to="/login">Войти</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">ФИО</label>
            <input className="input" style={{ width: '100%' }} placeholder="Иванова М. С." value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="input" style={{ width: '100%' }} type="email" placeholder="you@organization.ru" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Организация</label>
          <input className="input" style={{ width: '100%' }} value={form.org} onChange={(e) => set('org', e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Роль</label>
          <div className="role-grid">
            {ROLE_LIST.map((r) => (
              <div
                key={r.value}
                className={'role-option' + (form.role === r.value ? ' selected' : '')}
                onClick={() => set('role', r.value)}
              >
                <div style={{ fontWeight: 700, fontSize: 12.5 }}>{r.label}</div>
                <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>{r.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Пароль</label>
            <input className="input" style={{ width: '100%' }} type="password" autoComplete="new-password" placeholder="Минимум 6 символов" value={form.password} onChange={(e) => set('password', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Подтверждение пароля</label>
            <input className="input" style={{ width: '100%' }} type="password" autoComplete="new-password" placeholder="Повторите пароль" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} />
          </div>
        </div>

        <label className="checkbox-row">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          Согласен(на) на обработку персональных данных в соответствии с 152-ФЗ
        </label>

        {error && <div className="form-error" role="alert"><Icon name="alert" size={13} /> {error}</div>}

        <button className="btn btn-primary btn-block" style={{ marginTop: 6 }} type="submit" disabled={loading}>
          {loading ? 'Создание аккаунта…' : 'Создать аккаунт'}
        </button>
      </form>
    </AuthLayout>
  )
}
