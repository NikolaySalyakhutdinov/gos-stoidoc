import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthLayout from '../../components/AuthLayout'
import Icon from '../../components/Icon'
import { useAuth } from '../../store/AuthStore'

export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    if (!email) return
    requestPasswordReset(email)
    setSent(true)
  }

  return (
    <AuthLayout
      title="Восстановление пароля"
      subtitle="Укажите email, привязанный к аккаунту"
      footer={
        <>
          Вспомнили пароль? <Link className="link-btn" to="/login">Вернуться ко входу</Link>
        </>
      }
    >
      {sent ? (
        <div className="scenario-banner" style={{ background: 'var(--green-bg)', color: 'var(--green)', border: '1px solid var(--green-border)' }}>
          <Icon name="check" size={16} />
          Если аккаунт с адресом «{email}» существует, на него отправлена ссылка для сброса пароля.
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="input"
              style={{ width: '100%' }}
              type="email"
              placeholder="you@organization.ru"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit">
            Отправить ссылку для восстановления
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
