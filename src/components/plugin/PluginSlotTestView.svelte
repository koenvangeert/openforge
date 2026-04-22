<script lang="ts">
  interface Props {
    projectName?: string
  }

  let { projectName = '' }: Props = $props()
</script>

<div data-testid="plugin-slot-view">Plugin view for {projectName}</div>
