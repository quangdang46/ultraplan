export type ApiErrorResponse = {
  success: false
  error: string
  message?: string
}

export type ApiOkResponse<T> = T
