const inlineTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
export const canPreviewInline = (mimeType: string) => inlineTypes.has(mimeType.toLowerCase())
export function safeDispositionName(name: string) { return name.replace(/[\r\n"\\]/g, '_').slice(0, 200) || 'download' }
export function contentDisposition(name: string, inline: boolean) { return `${inline ? 'inline' : 'attachment'}; filename="${safeDispositionName(name)}"` }
