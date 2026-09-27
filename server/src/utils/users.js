export function toPublicUser(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    org: row.org,
    phone: row.phone,
    createdAt: row.created_at,
    notifPrefs: {
      emailDigest: !!row.notif_email_digest,
      criticalAlerts: !!row.notif_critical,
      weeklyReport: !!row.notif_weekly,
    },
  }
}
