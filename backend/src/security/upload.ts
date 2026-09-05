export const MAX_FILENAME_LENGTH = 255

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/pdf',
])

export function isAllowedMimeType(mimeType: string) {
  return ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())
}

function ascii(buffer: Buffer, start: number, length: number) {
  return buffer.toString('latin1', start, start + length)
}

/**
 * Detect a file's MIME type from its leading bytes. Only known, safe types are
 * returned; anything unrecognized yields `null` and is rejected upstream so we
 * never trust the browser-supplied MIME type or filename extension alone.
 */
export function detectFileType(buffer: Buffer): string | null {
  if (buffer.length < 4) return null

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'

  // GIF87a / GIF89a
  const gif = ascii(buffer, 0, 6)
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'

  // WebP: RIFF....WEBP
  if (buffer.length >= 12 && ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WEBP') return 'image/webp'

  // WebM (EBML): 1A 45 DF A3
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video/webm'

  // PDF
  if (buffer.length >= 5 && ascii(buffer, 0, 5) === '%PDF-') return 'application/pdf'

  // ISO Base Media File Format (MP4, MOV/QuickTime, HEIC/HEIF).
  if (buffer.length >= 12 && ascii(buffer, 4, 4) === 'ftyp') {
    const brand = ascii(buffer, 8, 4)
    if (brand === 'qt  ') return 'video/quicktime'
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic'
    if (['mif1', 'msf1', 'heif'].includes(brand)) return 'image/heif'
    if (['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ', 'M4VH', 'M4VP', 'F4V ', 'F4P '].includes(brand)) return 'video/mp4'
    return null
  }

  return null
}
