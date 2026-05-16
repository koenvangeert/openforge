export function getFileStatusIcon(status: string): string {
  switch (status) {
    case 'added':
      return '+'
    case 'removed':
      return '−'
    case 'modified':
      return '±'
    case 'renamed':
      return '→'
    default:
      return '•'
  }
}

export function getFileStatusColor(status: string): string {
  switch (status) {
    case 'added':
      return 'var(--success)'
    case 'removed':
      return 'var(--error)'
    case 'modified':
      return 'var(--warning)'
    case 'renamed':
      return 'var(--accent)'
    default:
      return 'var(--text-secondary)'
  }
}

export function getFileStatusClass(status: string): string {
  switch (status) {
    case 'added':
      return 'text-success'
    case 'removed':
      return 'text-error'
    case 'modified':
      return 'text-warning'
    case 'renamed':
      return 'text-primary'
    default:
      return 'text-base-content/50'
  }
}

export function getFileStatusLabel(status: string): string {
  switch (status) {
    case 'added':
      return 'Added'
    case 'removed':
      return 'Deleted'
    case 'modified':
      return 'Modified'
    case 'renamed':
      return 'Renamed'
    default:
      return status
  }
}
