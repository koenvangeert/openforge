export type OpenExternal = (url: string) => Promise<void>

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
  } catch {
    return false
  }
}

export async function openExternalUrl(url: string, openExternal: OpenExternal): Promise<null> {
  if (!isAllowedExternalUrl(url)) {
    throw new Error('open_url only supports http and https URLs')
  }

  await openExternal(url)
  return null
}
