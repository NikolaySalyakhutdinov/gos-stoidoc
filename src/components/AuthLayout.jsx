import Icon from './Icon'

const FEATURES = [
  { icon: 'layers', text: 'Сверка ПД / РД / ИД по 132 параметрам матрицы контроля' },
  { icon: 'check', text: 'Верификация нарушений инспектором с полной трассируемостью решений' },
  { icon: 'bolt', text: 'API-интеграция с ИАИС «Разрешения и нарушения»' },
]

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="auth-brand-glow" />
        <div className="auth-brand-content">
          <div className="brand" style={{ padding: 0, marginBottom: 40 }}>
            <div className="brand-mark"><Icon name="building" size={19} /></div>
            <div>
              <div className="brand-title" style={{ fontSize: 18 }}>Стройнадзор ИИ</div>
              <div className="brand-sub">Контроль Москвы · Стройнадзор</div>
            </div>
          </div>

          <h1 className="auth-brand-title">
            ИИ-платформа камеральной проверки строительной документации
          </h1>
          <p className="auth-brand-text">
            Автоматизированная сверка проектной, рабочей и исполнительной документации
            объектов капитального строительства.
          </p>

          <div className="auth-feature-list">
            {FEATURES.map((f) => (
              <div className="auth-feature" key={f.text}>
                <span className="auth-feature-icon"><Icon name={f.icon} size={14} /></span>
                {f.text}
              </div>
            ))}
          </div>
        </div>
        <div className="auth-brand-footer">Прототип интерфейса — данные демонстрационные</div>
      </div>

      <div className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-card-head">
            <div className="page-title" style={{ fontSize: 21 }}>{title}</div>
            {subtitle && <div className="page-subtitle" style={{ marginTop: 6 }}>{subtitle}</div>}
          </div>
          {children}
          {footer && <div className="auth-card-footer">{footer}</div>}
        </div>
      </div>
    </div>
  )
}
