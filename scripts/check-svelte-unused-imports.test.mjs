import { describe, expect, it } from 'vitest'
import { findUnusedSvelteImports } from './check-svelte-unused-imports.mjs'

describe('findUnusedSvelteImports', () => {
  it('reports stale imports from Svelte script blocks', () => {
    const source = `<script lang="ts">
      import UsedComponent from './UsedComponent.svelte'
      import UnusedComponent from './UnusedComponent.svelte'
      import { usedHelper, unusedHelper } from './helpers'

      const value = usedHelper()
    </script>

    <UsedComponent {value} />`

    expect(findUnusedSvelteImports(source).map((item) => item.name)).toEqual([
      'UnusedComponent',
      'unusedHelper',
    ])
  })

  it('counts Svelte store auto-subscriptions and type references as usage', () => {
    const source = `<script lang="ts">
      import type { Snippet } from 'svelte'
      import { activeProjectId } from './stores'

      interface Props {
        children?: Snippet
      }
    </script>

    {#if $activeProjectId}
      <p>Project selected</p>
    {/if}`

    expect(findUnusedSvelteImports(source)).toEqual([])
  })
})
