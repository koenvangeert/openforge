import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { initTheme } from './lib/theme'
import { initLogger } from './lib/logger'

initTheme()
initLogger().catch(() => {})

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
