export default function StatusBadge({ color = 'grey', children, dot = true }) {
  return (
    <span className={`badge badge-${color}`}>
      {dot && <span className={`dot`} style={{ background: `var(--${colorVar(color)})` }} />}
      {children}
    </span>
  )
}

function colorVar(color) {
  if (color === 'purple') return 'purple-600'
  return color
}
