<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    taskId?: string
    projectId?: string | null
  }

  let { api, context, taskId = '', projectId = null }: Props = $props()
</script>

<div data-testid="plugin-runtime-props">
  {context.pluginId}:{context.projectId}:{context.taskId}:{taskId}:{projectId}:{api ? 'api' : 'missing'}
</div>
