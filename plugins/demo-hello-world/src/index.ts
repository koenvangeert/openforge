import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import DemoTab from './components/DemoTab.svelte'
import HelloWorldView from './components/HelloWorldView.svelte'

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.views.register({
      id: 'hello',
      title: 'Hello World',
      icon: 'plug',
      placement: 'rail',
      order: 200,
      shortcut: 'Cmd+Shift+H',
      component: HelloWorldView,
    }))

    context.subscriptions.add(openforge.taskPane.registerTab({
      id: 'demo-tab',
      title: 'Demo',
      icon: 'sparkles',
      order: 50,
      component: DemoTab,
    }))

    context.subscriptions.add(openforge.commands.register({
      id: 'say-hello',
      title: 'Say Hello',
      shortcut: 'Cmd+Shift+H',
      handler: async () => ({ message: 'Hello from OpenForge demo plugin' }),
    }))

    context.subscriptions.add(openforge.settings.registerSection({
      id: 'demo-settings',
      title: 'Demo Settings',
      component: DemoTab,
    }))
  },
})
