export const ROLES = {
  INSPECTOR: {
    label: 'Инспектор',
    desc: 'Просмотр протоколов и верификация нарушений',
  },
  ADMIN: {
    label: 'Администратор',
    desc: 'Управление параметрами матрицы и нормативной базой',
  },
  ML_ENGINEER: {
    label: 'ML-инженер',
    desc: 'Доступ к логам и данным дообучения моделей',
  },
}

export const ROLE_LIST = Object.entries(ROLES).map(([value, v]) => ({ value, ...v }))
