import type { Disposable, OpenForgePackageMetadata, OpenForgePluginContext, SubscriptionSink, SupportedOpenForgeApiVersion } from './types'

class SubscriptionSet implements SubscriptionSink {
  private readonly subscriptions = new Set<Disposable | (() => void)>()

  add(subscription: Disposable | (() => void)): void {
    this.subscriptions.add(subscription)
  }

  async disposeAll(): Promise<void> {
    const subscriptions = [...this.subscriptions]
    this.subscriptions.clear()

    await Promise.all(subscriptions.map(async (subscription) => {
      if (typeof subscription === 'function') {
        subscription()
      } else {
        await subscription.dispose()
      }
    }))
  }
}

export class PluginContextImpl implements OpenForgePluginContext {
  readonly subscriptions: SubscriptionSet

  constructor(
    readonly pluginId: string,
    readonly apiVersion: SupportedOpenForgeApiVersion,
    readonly packageMetadata: OpenForgePackageMetadata,
  ) {
    this.subscriptions = new SubscriptionSet()
  }
}
