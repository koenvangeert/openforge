<script lang="ts">
  import AppTerminalTabs from '../../../src/components/task-detail/TerminalTabs.svelte'

  interface Props {
    taskId: string
    workspacePath: string
    onTabChange: ((index: number) => void) | null
    onTabCountChange: ((count: number) => void) | null
  }

  let props: Props = $props()
  let appTerminalTabsRef = $state<any>(null)

  export function addTab() {
    appTerminalTabsRef?.addTab()
  }

  export async function closeActiveTab() {
    await appTerminalTabsRef?.closeActiveTab()
  }

  export function focusActiveTab() {
    appTerminalTabsRef?.focusActiveTab()
  }

  export function switchToTab(tabIndex: number) {
    appTerminalTabsRef?.switchToTab(tabIndex)
  }
</script>

<AppTerminalTabs bind:this={appTerminalTabsRef} {...props} />
