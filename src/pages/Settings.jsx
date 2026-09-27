import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthStore'
import { useTheme } from '../store/ThemeStore'
import Icon from '../components/Icon'
import { ROLE_LIST, ROLES } from '../data/roles'
import { initials, formatDateTime } from '../utils/helpers'

const TABS = [
  { key: 'profile', label: 'Профиль', icon: 'file' },
  { key: 'security', label: 'Безопасность', icon: 'lock' },
  { key: 'notifications', label: 'Уведомления', icon: 'bolt' },
  { key: 'appearance', label: 'Вид', icon: 'sun' },
  { key: 'org', label: 'Организация', icon: 'building' },
]

export default function Settings() {
  const { currentUser, updateProfile, changePassword, updateNotifPrefs, signOut } = useAuth()
  const nav = useNavigate()
  const [tab, setTab] = useState('profile')

  if (!currentUser) return null

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Настройки</div>
          <div className="page-subtitle">Профиль, безопасность, уведомления, вид и данные организации</div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <div key={t.key} className={'tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={13} /> {t.label}
          </div>
        ))}
      </div>

      {tab === 'profile' && <ProfileTab user={currentUser} updateProfile={updateProfile} />}
      {tab === 'security' && <SecurityTab changePassword={changePassword} signOut={signOut} nav={nav} />}
      {tab === 'notifications' && <NotificationsTab user={currentUser} updateNotifPrefs={updateNotifPrefs} />}
      {tab === 'appearance' && <AppearanceTab />}
      {tab === 'org' && <OrgTab user={currentUser} updateProfile={updateProfile} />}
    </div>
  )
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme()
  const options = [
    { value: 'light', label: 'Светлая', icon: 'sun', desc: 'Классический светлый интерфейс' },
    { value: 'dark', label: 'Тёмная', icon: 'moon', desc: 'Тёмный фон, меньше нагрузки на глаза' },
  ]
  return (
    <div className="card card-pad" style={{ maxWidth: 560 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Тема оформления</div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 16 }}>
        Применяется сразу и сохраняется в этом браузере.
      </p>
      <div className="role-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {options.map((o) => (
          <div
            key={o.value}
            className={'role-option theme-option' + (theme === o.value ? ' selected' : '')}
            onClick={() => setTheme(o.value)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="auth-feature-icon" style={{ background: 'var(--violet-100)', color: 'var(--violet-700)', border: 'none' }}>
                <Icon name={o.icon} size={14} />
              </span>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{o.label}</span>
            </div>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>{o.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SavedHint({ show }) {
  if (!show) return null
  return (
    <div className="badge badge-green" style={{ marginLeft: 10 }}>
      <Icon name="check" size={11} /> Сохранено
    </div>
  )
}

function ProfileTab({ user, updateProfile }) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [phone, setPhone] = useState(user.phone || '')
  const [saved, setSaved] = useState(false)

  function save() {
    updateProfile({ name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim() })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="card card-pad" style={{ maxWidth: 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <div className="avatar" style={{ width: 52, height: 52, fontSize: 16 }}>{initials(user.name)}</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{user.name}</div>
          <div className="badge badge-purple" style={{ marginTop: 4 }}>{ROLES[user.role]?.label}</div>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">ФИО</label>
        <input className="input" style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Email</label>
        <input className="input" style={{ width: '100%' }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Телефон</label>
        <input className="input" style={{ width: '100%' }} placeholder="+7 (___) ___-__-__" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="hint" style={{ marginBottom: 12 }}>Аккаунт создан {formatDateTime(user.createdAt)}</div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={save}>Сохранить изменения</button>
        <SavedHint show={saved} />
      </div>
    </div>
  )
}

function SecurityTab({ changePassword, signOut, nav }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  function submit(e) {
    e.preventDefault()
    setError('')
    if (next !== confirm) {
      setError('Новые пароли не совпадают')
      return
    }
    const res = changePassword(current, next)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setCurrent(''); setNext(''); setConfirm('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleSignOutEverywhere() {
    signOut()
    nav('/login', { replace: true })
  }

  return (
    <div className="grid-2" style={{ maxWidth: 900 }}>
      <div className="card card-pad">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Смена пароля</div>
        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label">Текущий пароль</label>
            <input className="input" style={{ width: '100%' }} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Новый пароль</label>
            <input className="input" style={{ width: '100%' }} type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Подтверждение</label>
            <input className="input" style={{ width: '100%' }} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && <div className="form-error"><Icon name="alert" size={13} /> {error}</div>}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button className="btn btn-primary" type="submit">Обновить пароль</button>
            <SavedHint show={saved} />
          </div>
        </form>
      </div>

      <div className="card card-pad">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Активная сессия</div>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          Вход выполнен в этом браузере. Данные сессии хранятся локально и не передаются на сервер —
          это демонстрационный контур без боевого бэкенда.
        </p>
        <div className="divider" />
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--red)' }}>Опасная зона</div>
        <p className="muted" style={{ fontSize: 12.5 }}>Завершить сессию на этом устройстве.</p>
        <button className="btn btn-danger" onClick={handleSignOutEverywhere}>
          <Icon name="lock" size={13} /> Выйти из аккаунта
        </button>
      </div>
    </div>
  )
}

function NotificationsTab({ user, updateNotifPrefs }) {
  const prefs = user.notifPrefs || {}
  return (
    <div className="card card-pad" style={{ maxWidth: 560 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Уведомления</div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 16 }}>
        Настройки применяются мгновенно и сохраняются в вашем профиле.
      </p>

      <ToggleRow
        label="Дайджест по email"
        desc="Ежедневная сводка по объектам в работе"
        checked={!!prefs.emailDigest}
        onChange={(v) => updateNotifPrefs({ emailDigest: v })}
      />
      <ToggleRow
        label="Критические нарушения"
        desc="Мгновенное уведомление при статусе CONFIRMED_VIOLATION с приоритетом HIGH"
        checked={!!prefs.criticalAlerts}
        onChange={(v) => updateNotifPrefs({ criticalAlerts: v })}
      />
      <ToggleRow
        label="Еженедельный отчёт по дообучению"
        desc="Статистика отклонений и рекомендации по донастройке моделей"
        checked={!!prefs.weeklyReport}
        onChange={(v) => updateNotifPrefs({ weeklyReport: v })}
      />
    </div>
  )
}

function ToggleRow({ label, desc, checked, onChange }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ paddingRight: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
        <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{desc}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        className={'toggle-switch' + (checked ? ' on' : '')}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  )
}

function OrgTab({ user, updateProfile }) {
  const [org, setOrg] = useState(user.org)
  const [saved, setSaved] = useState(false)

  function save() {
    updateProfile({ org: org.trim() })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="grid-2" style={{ maxWidth: 900 }}>
      <div className="card card-pad">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Организация</div>
        <div className="form-group">
          <label className="form-label">Наименование</label>
          <input className="input" style={{ width: '100%' }} value={org} onChange={(e) => setOrg(e.target.value)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={save}>Сохранить</button>
          <SavedHint show={saved} />
        </div>
      </div>

      <div className="card card-pad">
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Роли в системе</div>
        {ROLE_LIST.map((r) => (
          <div key={r.value} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{r.label}</span>
              {r.value === user.role && <span className="badge badge-purple">текущая</span>}
            </div>
            <div className="faint" style={{ fontSize: 11.5, marginTop: 3 }}>{r.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
