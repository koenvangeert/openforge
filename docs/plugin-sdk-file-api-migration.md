# Plugin SDK file content migration

`FileSystemAPI.readFile()` now resolves a `FileContent` object instead of a raw string. This lets plugin authors safely distinguish text previews from image previews, binary/document placeholders, and files that are too large to inline.

```ts
import type { FileContent } from '@openforge/plugin-sdk'

const file: FileContent = await api.fs.readFile({ projectId, path: 'README.md' })
```

## Migration note

Before, plugins commonly treated `readFile()` as text-only:

```ts
const content = await api.fs.readFile({ projectId, path })
renderText(content)
```

After the migration, branch on `FileContent.type` and only read `content` as text when the host says it is text:

```ts
const file = await api.fs.readFile({ projectId, path })

switch (file.type) {
  case 'text':
    renderText(file.content, file.mimeType)
    break
  case 'image':
    renderImage(`data:${file.mimeType ?? 'application/octet-stream'};base64,${file.content}`)
    break
  case 'document':
    renderDocumentPlaceholder({ mimeType: file.mimeType, size: file.size })
    break
  case 'binary':
  case 'large-file':
    renderUnavailablePreview({ kind: file.type, size: file.size })
    break
}
```

`content` is no longer a universal text string. Treat it according to `type`:

| `FileContent.type` | `content` shape | Author guidance |
| --- | --- | --- |
| `text` | UTF-8 text | Render or parse as text. Use `mimeType` for syntax highlighting or format-specific handling. |
| `image` | base64 bytes | Build a `data:` URL from `mimeType` and `content`, or pass the base64 payload to an image renderer. |
| `document` | empty string | Do not parse `content`; show a document preview/download placeholder using `mimeType` and `size`. |
| `binary` | empty string | Do not parse `content`; show an unsupported/binary placeholder using `size`. |
| `large-file` | empty string | Do not render inline; show a too-large placeholder using `size`. |

The metadata fields are always part of the contract:

- `mimeType: string | null` identifies known text/image/document formats and may be `null` for unknown binary files.
- `size: number` is the file size in bytes, including when `content` is intentionally empty.

## Testing fixture guidance

Update plugin fixtures and fakes so they return `FileContent`, not strings. The SDK mock API defaults `readFile()` to an empty text file, and tests can override it per case:

```ts
import { createMockOpenForgeApi } from '@openforge/plugin-sdk/testing'
import type { FileContent } from '@openforge/plugin-sdk'

const readme: FileContent = {
  type: 'text',
  content: '# Hello',
  mimeType: 'text/markdown',
  size: 7,
}

const logo: FileContent = {
  type: 'image',
  content: 'iVBORw0KGgo=',
  mimeType: 'image/png',
  size: 8,
}

const pdf: FileContent = {
  type: 'document',
  content: '',
  mimeType: 'application/pdf',
  size: 15360,
}

const archive: FileContent = {
  type: 'binary',
  content: '',
  mimeType: null,
  size: 4096,
}

const api = createMockOpenForgeApi({ pluginId: 'acme.viewer', projectId: 'P-1' })
api.fs.readFile = async ({ path }) => {
  if (path.endsWith('.png')) return logo
  if (path.endsWith('.pdf')) return pdf
  if (path.endsWith('.zip')) return archive
  return readme
}
```

Recommended fixture coverage for file-reading plugins:

1. A text fixture that asserts the plugin renders `content` as text and uses `mimeType` where relevant.
2. An image fixture that asserts the plugin treats `content` as base64 and prefixes it with the returned `mimeType`.
3. A document fixture, such as PDF metadata, that asserts the plugin uses `mimeType`/`size` and does not attempt to render empty `content` as text.
4. A binary or `large-file` fixture that asserts the plugin shows an unsupported or too-large state without reading `content`.

If your tests use local hand-written API objects instead of `@openforge/plugin-sdk/testing`, update the `fs.readFile` fake signature to `Promise<FileContent>` and include `type`, `content`, `mimeType`, and `size` in every fixture.
