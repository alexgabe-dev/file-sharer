/** Replace shared-space tokens in a URL path so they never reach logs. */
export function redactUrl(url: string): string {
  return url.replace(/\/spaces\/[^/?#]+/g, '/spaces/[redacted]')
}
