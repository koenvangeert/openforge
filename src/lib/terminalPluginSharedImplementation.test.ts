import { describe, expect, it, beforeEach } from 'vitest'
import { get } from 'svelte/store'

import { commandHeld as appCommandHeld } from './stores'
import { setupCommandHeldListeners as appSetupCommandHeldListeners } from './useCommandHeld.svelte'
import {
  acquire as appAcquire,
  focusTerminal as appFocusTerminal,
  getTaskTerminalTabsSession as appGetTaskTerminalTabsSession,
  release as appRelease,
  updateTaskTerminalTabsSession as appUpdateTaskTerminalTabsSession,
} from './terminalPool'
import {
  clearTerminalTaskPaneControllers as clearAppControllers,
  getTerminalTaskPaneController as getAppController,
  registerTerminalTaskPaneController as registerAppController,
  type TerminalTaskPaneController,
} from '../components/task-detail/terminalTaskPaneController'

import { commandHeld as pluginCommandHeld } from '../../plugins/terminal/src/lib/stores'
import { setupCommandHeldListeners as pluginSetupCommandHeldListeners } from '../../plugins/terminal/src/lib/stores'
import {
  acquire as pluginAcquire,
  focusTerminal as pluginFocusTerminal,
  getTaskTerminalTabsSession as pluginGetTaskTerminalTabsSession,
  release as pluginRelease,
  updateTaskTerminalTabsSession as pluginUpdateTaskTerminalTabsSession,
} from '../../plugins/terminal/src/lib/terminalPool'
import {
  clearTerminalTaskPaneControllers as clearPluginControllers,
  getTerminalTaskPaneController as getPluginController,
  registerTerminalTaskPaneController as registerPluginController,
  unregisterTerminalTaskPaneController as unregisterPluginController,
} from '../../plugins/terminal/src/terminalTaskPaneController'

describe('terminal plugin shared implementation', () => {
  beforeEach(() => {
    appCommandHeld.set(false)
    pluginCommandHeld.set(false)
    clearAppControllers()
    clearPluginControllers()
  })

  it('uses the app terminal pool as the plugin terminal pool', () => {
    expect(pluginAcquire).toBe(appAcquire)
    expect(pluginRelease).toBe(appRelease)
    expect(pluginFocusTerminal).toBe(appFocusTerminal)
    expect(pluginGetTaskTerminalTabsSession).toBe(appGetTaskTerminalTabsSession)
    expect(pluginUpdateTaskTerminalTabsSession).toBe(appUpdateTaskTerminalTabsSession)
  })

  it('uses one command-held store and listener setup for app shell and terminal plugin', () => {
    expect(pluginCommandHeld).toBe(appCommandHeld)
    expect(pluginSetupCommandHeldListeners).toBe(appSetupCommandHeldListeners)

    appCommandHeld.set(true)
    expect(get(pluginCommandHeld)).toBe(true)

    pluginCommandHeld.set(false)
    expect(get(appCommandHeld)).toBe(false)
  })

  it('uses one task-pane controller registry for app shell and terminal plugin', async () => {
    const controller: TerminalTaskPaneController = {
      addTab() {},
      async closeActiveTab() {},
      focusActiveTab() {},
      switchToTab() {},
    }

    registerAppController('T-861', controller)
    expect(getPluginController('T-861')).toBe(controller)

    unregisterPluginController('T-861', controller)
    expect(getAppController('T-861')).toBeUndefined()

    registerPluginController('T-861', controller)
    expect(getAppController('T-861')).toBe(controller)
  })
})
