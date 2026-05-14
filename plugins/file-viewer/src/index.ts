import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge/plugin-sdk/frontend'
import FilesView from './FilesView.svelte'
import { setPluginContext } from './pluginContext'
import type { PluginContext } from './pluginContext'

export const FilesViewComponent = FilesView

function createLegacyContext(openforge: FrontendOpenForgeAPI, context: FrontendPluginContext): PluginContext {
  return {
    pluginId: context.pluginId,
    invokeHost: async (command, payload) => {
      const request = payload as Record<string, unknown> | undefined
      switch (command) {
        case 'fsReadDir':
          return openforge.fs.readDir({
            projectId: String(request?.projectId ?? ''),
            path: typeof request?.dirPath === 'string' ? request.dirPath : null,
          })
        case 'fsReadFile': {
          const content = await openforge.fs.readFile({
            projectId: String(request?.projectId ?? ''),
            path: String(request?.filePath ?? ''),
          })
          return { type: 'text', content, mimeType: null, size: content.length }
        }
        case 'openUrl':
          return openforge.system.openUrl(String(request?.url ?? ''))
        default:
          throw new Error(`Unsupported file-viewer host command: ${command}`)
      }
    },
    invokeBackend: (method, payload) => openforge.backend.invoke(method, payload),
    onEvent: (event, handler) => {
      const subscription = openforge.events.onGlobal(event, handler)
      return () => subscription.dispose()
    },
    storage: openforge.storage,
  }
}

export default defineFrontendPlugin({
  activate(openforge, context) {
    setPluginContext(createLegacyContext(openforge, context))
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
