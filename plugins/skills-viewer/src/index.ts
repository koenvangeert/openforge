import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import SkillsView from './SkillsView.svelte'

export const SkillsViewComponent = SkillsView

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.views.register({
      id: 'skills',
      title: 'Skills',
      icon: 'sparkles',
      placement: 'rail',
      order: 30,
      shortcut: 'Cmd+L',
      component: SkillsView,
    }))
  },
})
