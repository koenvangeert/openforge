import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

type JsonRpcRequest = {
  jsonrpc?: string
  id?: number
  method?: string
  params?: {
    pluginId?: string
    command?: string
    backendPath?: string
    payload?: unknown
  }
}

const loadedBackends = new Map<string, Record<string, unknown>>()

function respond(id: number | undefined, body: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...body })}\n`)
}

async function loadBackend(backendPath: string): Promise<Record<string, unknown>> {
  const existing = loadedBackends.get(backendPath)
  if (existing) {
    return existing
  }

  const module = (await import(pathToFileURL(backendPath).href)) as Record<string, unknown>
  loadedBackends.set(backendPath, module)
  return module
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  if (request.jsonrpc !== '2.0' || typeof request.id !== 'number') {
    respond(request.id, { error: { code: -32600, message: 'Invalid request' } })
    return
  }

  const pluginId = request.params?.pluginId
  const command = request.params?.command
  const backendPath = request.params?.backendPath
  if (typeof pluginId !== 'string' || typeof command !== 'string' || typeof backendPath !== 'string') {
    respond(request.id, { error: { code: -32602, message: 'Missing plugin invocation metadata' } })
    return
  }

  try {
    const module = await loadBackend(backendPath)
    const candidate = module[command] ?? (typeof module.default === 'object' && module.default !== null
      ? (module.default as Record<string, unknown>)[command]
      : undefined)

    if (typeof candidate !== 'function') {
      respond(request.id, { error: { code: -32601, message: `Backend method not found for ${pluginId}.${command}` } })
      return
    }

    const result = await (candidate as (payload: unknown) => Promise<unknown> | unknown)(request.params?.payload)
    respond(request.id, { result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    respond(request.id, { error: { code: -32603, message } })
  }
}

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

input.on('line', (line) => {
  if (!line.trim()) {
    return
  }

  let request: JsonRpcRequest
  try {
    request = JSON.parse(line) as JsonRpcRequest
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message } })}\n`)
    return
  }

  void handleRequest(request)
})

input.on('close', () => {
  process.exit(0)
})
