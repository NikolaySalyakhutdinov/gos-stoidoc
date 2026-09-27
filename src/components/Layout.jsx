import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { useAuth } from '../store/AuthStore'
import { useTheme } from '../store/ThemeStore'
import { initials } from '../utils/helpers'
import { ROLES } from '../data/roles'

const NAV = [
  { to: '/', label: 'Дашборд объектов', icon: 'dashboard', end: true },
  { to: '/matrix', label: 'Матрица контроля', icon: 'matrix' },
  { to: '/audit', label: 'Журнал аудита', icon: 'audit' },
]

export default function Layout() {
  const { currentUser, signOut } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const location = useLocation()
  const nav = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    setMenuOpen(false)
    setMobileNavOpen(false)
  }, [location.pathname])

  function handleLogout() {
    signOut()
    nav('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <aside className={'sidebar' + (mobileNavOpen ? ' open' : '')}>
        <div className="brand">
          <div className="brand-mark">
            <Icon name="building" size={18} />
          </div>
          <div>
            <div className="brand-title">Стройнадзор ИИ</div>
            <div className="brand-sub">Контроль Москвы · Стройнадзор</div>
          </div>
          <button className="sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Закрыть меню">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="nav-group-label">Рабочее пространство</div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
          >
            <span className="nav-icon"><Icon name={item.icon} size={14} /></span>
            {item.label}
          </NavLink>
        ))}

        <div className="nav-group-label">Аккаунт</div>
        <NavLink to="/settings" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
          <span className="nav-icon"><Icon name="lock" size={14} /></span>
          Настройки
        </NavLink>
        {currentUser && (
          <div className="nav-link" style={{ opacity: 0.55, cursor: 'default' }}>
            <span className="nav-icon"><Icon name="sparkle" size={14} /></span>
            {ROLES[currentUser.role]?.label}
          </div>
        )}

        <div className="sidebar-footer">
          Версия матрицы v1.1 · модель inspector-cv-nlp-0.9.2
          <br />
          Прототип интерфейса — данные демонстрационные
        </div>
      </aside>

      {mobileNavOpen && <div className="mobile-backdrop show" onClick={() => setMobileNavOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="hamburger-btn" onClick={() => setMobileNavOpen(true)} aria-label="Открыть меню">
            <Icon name="menu" size={18} />
          </button>
          <div className="breadcrumbs">{buildBreadcrumb(location.pathname)}</div>
          <div className="topbar-search" onClick={() => nav('/')}>
            <Icon name="search" size={14} />
            <span>Поиск по объектам, параметрам…</span>
            <kbd>⌘K</kbd>
          </div>

          <button className="theme-toggle" onClick={toggleTheme} aria-label="Переключить тему" title={isDark ? 'Светлая тема' : 'Тёмная тема'}>
            <Icon name={isDark ? 'sun' : 'moon'} size={16} />
          </button>

          <div className="user-menu" ref={menuRef}>
            <div className="user-chip" onClick={() => setMenuOpen((v) => !v)}>
              <div className="avatar">{initials(currentUser?.name || '?')}</div>
              <div className="user-chip-text">
                <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{currentUser?.name}</div>
                <div className="hint" style={{ lineHeight: 1.3 }}>{ROLES[currentUser?.role]?.label}</div>
              </div>
              <Icon name="chevronDown" size={13} className="faint" />
            </div>

            {menuOpen && (
              <div className="user-dropdown">
                <div className="user-dropdown-head">
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{currentUser?.name}</div>
                  <div className="faint" style={{ fontSize: 12.5 }}>{currentUser?.email}</div>
                </div>
                <div className="user-dropdown-item" onClick={() => nav('/settings')}>
                  <Icon name="lock" size={14} /> Настройки
                </div>
                <div className="user-dropdown-item" onClick={toggleTheme}>
                  <Icon name={isDark ? 'sun' : 'moon'} size={14} /> {isDark ? 'Светлая тема' : 'Тёмная тема'}
                </div>
                <div className="user-dropdown-item danger" onClick={handleLogout}>
                  <Icon name="external" size={14} /> Выйти
                </div>
              </div>
            )}
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

function buildBreadcrumb(pathname) {
  if (pathname === '/') return <span><b>Дашборд объектов</b></span>
  if (pathname.startsWith('/matrix')) return <span><b>Матрица контроля</b> · данные из PostgreSQL</span>
  if (pathname.startsWith('/audit')) return <span><b>Журнал аудита</b></span>
  if (pathname.startsWith('/settings')) return <span><b>Настройки</b></span>
  if (pathname.includes('/upload')) return <span>Объекты <Icon name="chevronRight" size={12} /> <b>Загрузка документов</b></span>
  if (pathname.includes('/verify/')) return <span>Объекты <Icon name="chevronRight" size={12} /> Протокол <Icon name="chevronRight" size={12} /> <b>Верификация</b></span>
  if (pathname.includes('/protocol')) return <span>Объекты <Icon name="chevronRight" size={12} /> <b>Протокол проверки</b></span>
  if (pathname.startsWith('/objects/')) return <span>Объекты <Icon name="chevronRight" size={12} /> <b>Карточка объекта</b></span>
  return null
}
