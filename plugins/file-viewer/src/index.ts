import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import FilesView from './FilesView.svelte'

export const FilesViewComponent = FilesView

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.views.register({
      id: 'files',
      title: 'Files',
      icon: 'folder-open',
      placement: 'rail',
      order: 10,
      shortcut: 'Cmd+O',
      component: FilesView,
    }))
  },
})
