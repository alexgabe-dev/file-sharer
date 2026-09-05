export type ApiErrorCode =
  | 'SPACE_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'THUMBNAIL_NOT_FOUND'
  | 'FOLDER_NOT_FOUND'
  | 'FOLDER_EXISTS'
  | 'INVALID_FOLDER'
  | 'INVALID_FILENAME'
  | 'INVALID_FILE_TYPE'
  | 'INVALID_REQUEST'
  | 'FILE_REQUIRED'
  | 'FILE_EMPTY'
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'QUOTA_FILES'
  | 'QUOTA_STORAGE'
  | 'NOT_IN_TRASH'
  | 'STORAGE_ERROR'
  | 'RATE_LIMITED'
  | 'TOO_MANY_CONCURRENT'
  | 'UPLOAD_NOT_FOUND'
  | 'UPLOAD_EXPIRED'
  | 'UPLOAD_INVALID_STATE'
  | 'UPLOAD_INCOMPLETE'
  | 'INVALID_CHUNK'
  | 'CHECKSUM_MISMATCH'
  | 'INSUFFICIENT_SERVER_STORAGE'
  | 'UNAUTHORIZED'
  | 'INVALID_PASSWORD'
  | 'CSRF_MISMATCH'
  | 'INTERNAL_ERROR'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function errorBody(code: ApiErrorCode, message: string) {
  return { error: { code, message } }
}
