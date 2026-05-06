class MockWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null

  postMessage(_data: unknown): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean { return false }
}

globalThis.Worker = MockWorker as unknown as typeof Worker

if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: function getContext(this: HTMLCanvasElement, contextId: string) {
      if (contextId !== '2d') return null

      return {
        canvas: this,
        font: '',
        measureText: (text: string) => ({ width: text.length * 7 }) as TextMetrics,
        fillText: () => {},
        clearRect: () => {},
      } as unknown as CanvasRenderingContext2D
    },
    configurable: true,
    writable: true,
  })
}
