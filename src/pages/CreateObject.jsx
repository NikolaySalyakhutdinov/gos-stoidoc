import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useVerification } from '../store/VerificationStore'
import Icon from '../components/Icon'

export default function CreateObject() {
  const nav = useNavigate()
  const { createObject } = useVerification()

  const [form, setForm] = useState({
    name: '',
    object_code: '',
    address: '',
    customer: '',
    contractor: '',
    permit_number: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function validate() {
    if (!form.name.trim()) return 'Укажите наименование объекта'
    if (!form.object_code.trim()) return 'Укажите шифр объекта'
    if (!form.address.trim()) return 'Укажите адрес объекта'
    if (!form.customer.trim()) return 'Укажите застройщика / заказчика'
    if (!form.contractor.trim()) return 'Укажите подрядчика'
    if (!form.permit_number.trim()) return 'Укажите номер разрешения на строительство'
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
      const obj = await createObject(form)
      nav(`/objects/${obj.id}`)
    } catch (err) {
      setError(err.message || 'Не удалось создать объект')
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumbs" style={{ marginBottom: 6 }}>
            <Link to="/" className="link-btn">← К дашборду</Link>
          </div>
          <div className="page-title">Новый объект</div>
          <div className="page-subtitle">
            Заведите объект капитального строительства, чтобы затем загрузить по нему ПД/РД/ИД и запустить сверку.
          </div>
        </div>
      </div>

      <div className="card card-pad" style={{ maxWidth: 640 }}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Наименование объекта *</label>
            <input
              className="input"
              style={{ width: '100%' }}
              placeholder="Например: Общеобразовательная школа на 550 мест"
                value={form.name}
                required
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
                <label className="form-label">Шифр объекта *</label>
              <input
                className="input"
                style={{ width: '100%' }}
                placeholder="АНО/150321/1"
                value={form.object_code}
                required
                onChange={(e) => set('object_code', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Номер разрешения на строительство *</label>
              <input
                className="input"
                style={{ width: '100%' }}
                placeholder="77-123456-2026-RU"
                value={form.permit_number}
                required
                onChange={(e) => set('permit_number', e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Адрес объекта *</label>
            <input
              className="input"
              style={{ width: '100%' }}
              placeholder="г. Москва, ул. Примерная, вл. 1"
              value={form.address}
              required
              onChange={(e) => set('address', e.target.value)}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Застройщик / заказчик *</label>
              <input
                className="input"
                style={{ width: '100%' }}
                placeholder="ГКУ «Управление капитального строительства»"
                value={form.customer}
                required
                onChange={(e) => set('customer', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Подрядчик *</label>
              <input
                className="input"
                style={{ width: '100%' }}
                placeholder="ООО «СтройИнвест-15»"
                value={form.contractor}
                required
                onChange={(e) => set('contractor', e.target.value)}
              />
            </div>
          </div>

          {error && <div className="form-error" role="alert"><Icon name="alert" size={13} /> {error}</div>}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              <Icon name="plus" size={14} /> {loading ? 'Создание…' : 'Создать объект'}
            </button>
            <Link to="/" className="btn btn-ghost">Отмена</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
