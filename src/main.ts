import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'

const app = mount(App, {
  target: document.get3lementById('app')!,
})

export default app
