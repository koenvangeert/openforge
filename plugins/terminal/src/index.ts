import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import TerminalTaskPane from './TerminalTaskPane.svelte'
import TerminalProjectView from './TerminalProjectView.svelte'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.views.register({
      id: 'terminal',
      title: 'Terminal',
      icon: 'terminal',
      placement: 'rail',
      order: 40,
      shortcut: 'Cmd+J',
      component: TerminalProjectView,
    }))

    context.subscriptions.add(openforge.taskPane.registerTab({
      id: 'terminal',
      title: 'Terminal',
      icon: 'terminal',
      order: 10,
      component: TerminalTaskPane,
    }))
  },
})
