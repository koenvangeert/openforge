export * from '@openforge/plugin-sdk/domain'

export interface TaskLabel {
  id: number
  project_id: string
  name: string
  color: 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error'
}
