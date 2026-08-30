export type ErrorKind =
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'not_found'
  | 'conflict'
  | 'network'
  | 'server'
  | 'business'
  | 'upload'
  | 'rate_limited'
  | 'unknown'

export type NormalizedError = {
  kind: ErrorKind
  title: string
  hint: string
  code: string
  status: number
  fields?: Record<string, string>
  requestId?: string
  technicalMessage?: string
}

type CatalogEntry = {
  kind: ErrorKind
  title: string
  hint: string
}

const UNKNOWN: CatalogEntry = {
  kind: 'unknown',
  title: 'Не удалось выполнить действие',
  hint: 'Попробуйте ещё раз. Если проблема повторяется, обратитесь в поддержку.',
}

const CATALOG: Record<string, CatalogEntry> = {
  validation_error: {
    kind: 'validation',
    title: 'Проверьте заполнение полей',
    hint: 'Укажите недостающие данные и попробуйте снова.',
  },
  invalid_credentials: {
    kind: 'authentication',
    title: 'Неверный email или пароль',
    hint: 'Проверьте данные и попробуйте снова.',
  },
  session_expired: {
    kind: 'authentication',
    title: 'Сессия завершилась',
    hint: 'Войдите в аккаунт снова.',
  },
  unauthorized: {
    kind: 'authentication',
    title: 'Сессия завершилась',
    hint: 'Войдите в аккаунт снова.',
  },
  account_blocked: {
    kind: 'authorization',
    title: 'Аккаунт недоступен',
    hint: 'Обратитесь в поддержку, если это ошибка.',
  },
  forbidden: {
    kind: 'authorization',
    title: 'Нет доступа',
    hint: 'У вас нет доступа к этому разделу.',
  },
  not_found: {
    kind: 'not_found',
    title: 'Объект больше не доступен',
    hint: 'Обновите страницу и выберите другой вариант.',
  },
  conflict: {
    kind: 'conflict',
    title: 'Действие сейчас нельзя выполнить',
    hint: 'Обновите страницу и попробуйте снова.',
  },
  appointment_time_conflict: {
    kind: 'conflict',
    title: 'Это время уже занято',
    hint: 'Выберите другое время или другого мастера.',
  },
  appointment_status_invalid: {
    kind: 'conflict',
    title: 'Нельзя изменить эту запись',
    hint: 'Запись уже в другом статусе. Обновите страницу.',
  },
  appointment_concurrent_update: {
    kind: 'conflict',
    title: 'Запись только что изменилась',
    hint: 'Обновите страницу и повторите действие.',
  },
  appointment_not_reschedulable: {
    kind: 'business',
    title: 'Эту запись нельзя перенести',
    hint: 'Фиксированный сеанс переносится отменой и новой записью.',
  },
  services_different_salon: {
    kind: 'business',
    title: 'Нельзя объединить услуги в одну запись',
    hint: 'Выберите услуги одного салона.',
  },
  procedure_order_invalid: {
    kind: 'business',
    title: 'Такой порядок процедур недоступен',
    hint: 'Для этих услуг сначала рекомендуется другой порядок.',
  },
  booking_plan_unavailable: {
    kind: 'conflict',
    title: 'Не удалось подобрать общее время',
    hint: 'Попробуйте другую услугу или другую дату.',
  },
  occurrence_unavailable: {
    kind: 'conflict',
    title: 'Этот сеанс недоступен',
    hint: 'Выберите другое время.',
  },
  occurrence_full: {
    kind: 'conflict',
    title: 'На этот сеанс больше нет мест',
    hint: 'Выберите другое время.',
  },
  occurrence_overlap: {
    kind: 'conflict',
    title: 'Сеанс пересекается с другим',
    hint: 'Выберите другое время.',
  },
  booking_cutoff_passed: {
    kind: 'conflict',
    title: 'Запись на этот сеанс уже закрыта',
    hint: 'Выберите другое время.',
  },
  client_blacklisted: {
    kind: 'authorization',
    title: 'Запись к этому мастеру недоступна',
    hint: 'Выберите другого мастера.',
  },
  planner_outside_hours: {
    kind: 'conflict',
    title: 'Это время вне рабочих часов',
    hint: 'Выберите время внутри графика.',
  },
  planner_overlap: {
    kind: 'conflict',
    title: 'На это время уже есть событие',
    hint: 'Выберите другое время.',
  },
  email_already_registered: {
    kind: 'conflict',
    title: 'Этот email уже зарегистрирован',
    hint: 'Войдите в аккаунт или укажите другой email.',
  },
  price_changed: {
    kind: 'conflict',
    title: 'Цена товаров изменилась',
    hint: 'Обновите корзину и подтвердите оформление.',
  },
  insufficient_stock: {
    kind: 'conflict',
    title: 'Недостаточно товара на складе',
    hint: 'Уменьшите количество или выберите другой товар.',
  },
  profession_types_required: {
    kind: 'validation',
    title: 'Укажите хотя бы одну специализацию',
    hint: 'Выберите направление работы и сохраните профиль.',
  },
  profession_type_locked: {
    kind: 'business',
    title: 'Эту специализацию нельзя убрать',
    hint: 'Она уже используется в услугах или записях.',
  },
  media_unsupported_type: {
    kind: 'upload',
    title: 'Этот формат файла не поддерживается',
    hint: 'Загрузите JPG, PNG или WebP.',
  },
  media_too_large: {
    kind: 'upload',
    title: 'Файл слишком большой',
    hint: 'Выберите файл меньшего размера и попробуйте снова.',
  },
  media_empty: {
    kind: 'upload',
    title: 'Файл не выбран',
    hint: 'Выберите файл и повторите загрузку.',
  },
  network_error: {
    kind: 'network',
    title: 'Не удалось подключиться к серверу',
    hint: 'Проверьте соединение и попробуйте ещё раз.',
  },
  aborted: {
    kind: 'network',
    title: 'Действие отменено',
    hint: 'Повторите, если это было случайно.',
  },
  rate_limited: {
    kind: 'rate_limited',
    title: 'Слишком много попыток',
    hint: 'Подождите немного и попробуйте снова.',
  },
  internal_error: {
    kind: 'server',
    title: 'Сервис временно недоступен',
    hint: 'Попробуйте ещё раз через минуту.',
  },
  error: UNKNOWN,
}

const GENERIC_CODES = new Set([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'error',
  'internal_error',
])

const FIELD_LABELS: Record<string, string> = {
  name: 'Название',
  display_name: 'Имя',
  email: 'Email',
  password: 'Пароль',
  price: 'Стоимость',
  price_minor: 'Стоимость',
  price_rubles: 'Стоимость',
  duration_minutes: 'Длительность',
  starts_at: 'Время начала',
  ends_at: 'Время окончания',
}

const LEGACY_MESSAGE_TO_CODE: Array<{ match: string; code: string }> = [
  { match: 'invalid credentials', code: 'invalid_credentials' },
  { match: 'email already registered', code: 'email_already_registered' },
  { match: 'selected time is not available', code: 'appointment_time_conflict' },
  { match: 'time slot is not available', code: 'appointment_time_conflict' },
  { match: 'это время уже занято', code: 'appointment_time_conflict' },
  { match: 'client is blacklisted', code: 'client_blacklisted' },
  { match: 'invalid appointment status transition', code: 'appointment_status_invalid' },
  { match: 'cannot reschedule in current status', code: 'appointment_status_invalid' },
  { match: 'occurrence is not available', code: 'occurrence_unavailable' },
  { match: 'occurrence is full', code: 'occurrence_full' },
  { match: 'occurrence overlaps', code: 'occurrence_overlap' },
  { match: 'booking cutoff', code: 'booking_cutoff_passed' },
  { match: 'planner block is outside working hours', code: 'planner_outside_hours' },
  { match: 'planner block overlaps', code: 'planner_overlap' },
  { match: 'unsupported content type', code: 'media_unsupported_type' },
  { match: 'file exceeds size limit', code: 'media_too_large' },
  { match: 'file field is required', code: 'media_empty' },
  { match: 'цена изменилась', code: 'price_changed' },
  { match: 'refresh token', code: 'session_expired' },
  { match: 'invalid access token', code: 'session_expired' },
  { match: 'missing bearer', code: 'session_expired' },
  { match: 'account is blocked', code: 'account_blocked' },
]

const TECHNICAL_RE =
  /postgres|sqlstate|parse_error|stack trace|panic|typeerror|undefined is not|internal server error|constraint violation|econnrefused|failed to fetch|networkerror|axios|sql: |pq: |oid |goroutine /i

type ApiLike = {
  code?: string
  status?: number
  message?: string
  details?: Record<string, unknown>
  requestId?: string
  request_id?: string
  technicalMessage?: string
}

function isApiLike(error: unknown): error is ApiLike {
  return Boolean(error && typeof error === 'object' && ('code' in error || 'status' in error))
}

function hasCyrillic(text: string): boolean {
  return /[А-Яа-яЁё]/.test(text)
}

function isSafeUserMessage(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 280) return false
  if (TECHNICAL_RE.test(trimmed)) return false
  return hasCyrillic(trimmed)
}

function resolveCode(code: string, message: string): string {
  if (code && !GENERIC_CODES.has(code) && CATALOG[code]) return code
  const lower = message.toLowerCase()
  for (const row of LEGACY_MESSAGE_TO_CODE) {
    if (lower.includes(row.match)) return row.code
  }
  return code || 'error'
}

function statusFallback(status: number): CatalogEntry {
  if (status === 0) return CATALOG.network_error
  if (status === 400 || status === 422) return CATALOG.validation_error
  if (status === 401) return CATALOG.session_expired
  if (status === 403) return CATALOG.forbidden
  if (status === 404) return CATALOG.not_found
  if (status === 409) return CATALOG.conflict
  if (status === 429) return CATALOG.rate_limited
  if (status >= 500) return CATALOG.internal_error
  return UNKNOWN
}

function hintFromDetails(details?: Record<string, unknown>): string {
  if (!details) return ''
  const hint = details.hint
  return typeof hint === 'string' && isSafeUserMessage(hint) ? hint.trim() : ''
}

function extractFields(details?: Record<string, unknown>): Record<string, string> | undefined {
  if (!details) return undefined
  const raw = details.fields
  if (!raw || typeof raw !== 'object') return undefined
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) fields[key] = value
  }
  return Object.keys(fields).length ? fields : undefined
}

function formatFieldHint(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => {
      const label = FIELD_LABELS[key] ?? key
      return isSafeUserMessage(value) ? `${label}: ${value}` : `${label} заполнено неверно.`
    })
    .join('\n')
}

function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (error instanceof TypeError) return true
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /failed to fetch|networkerror|load failed|fetch failed|econnrefused|network request failed/i.test(msg)
}

function isAbort(error: unknown): boolean {
  if (error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError') {
    return true
  }
  const msg = error instanceof Error ? error.message : ''
  return /aborted|abort/i.test(msg) && !/aborterror/.test('')
}

export function normalizeError(error: unknown): NormalizedError {
  if (isAbort(error) && !isApiLike(error)) {
    return { ...CATALOG.aborted, code: 'aborted', status: 0 }
  }
  if (isNetworkFailure(error) && !isApiLike(error)) {
    return { ...CATALOG.network_error, code: 'network_error', status: 0 }
  }

  if (isApiLike(error)) {
    const technical = (error.technicalMessage || error.message || '').trim()
    const status = typeof error.status === 'number' ? error.status : 0
    const rawCode = typeof error.code === 'string' && error.code ? error.code : 'error'
    const code = resolveCode(rawCode, technical)
    const fields = extractFields(error.details)
    const requestId = error.requestId || error.request_id
    const catalog = CATALOG[code] && code !== 'error' ? CATALOG[code] : statusFallback(status)
    const fieldHint = fields ? formatFieldHint(fields) : ''
    const detailHint = hintFromDetails(error.details)

    if (code === 'procedure_order_invalid') {
      const reason = detailHint || (isSafeUserMessage(technical) ? technical : '')
      return {
        kind: catalog.kind,
        title: catalog.title,
        hint: reason ? `Для этих услуг ${reason}.` : catalog.hint,
        code,
        status,
        fields,
        requestId,
        technicalMessage: technical,
      }
    }

    if (GENERIC_CODES.has(code) && isSafeUserMessage(technical)) {
      return {
        kind: catalog.kind,
        title: technical,
        hint: fieldHint || '',
        code,
        status,
        fields,
        requestId,
        technicalMessage: technical,
      }
    }

    return {
      kind: catalog.kind,
      title: catalog.title,
      hint: fieldHint || catalog.hint,
      code,
      status,
      fields,
      requestId,
      technicalMessage: technical,
    }
  }

  if (typeof error === 'string' && isSafeUserMessage(error)) {
    return { kind: 'unknown', title: error.trim(), hint: '', code: 'error', status: 0 }
  }

  return { ...UNKNOWN, code: 'error', status: 0, technicalMessage: error instanceof Error ? error.message : undefined }
}

export function formatNormalized(error: NormalizedError): string {
  return error.hint ? `${error.title}\n${error.hint}` : error.title
}

export function formatUserError(error: unknown, fallbackTitle?: string): string {
  const normalized = normalizeError(error)
  const title = normalized.kind === 'unknown' && fallbackTitle ? fallbackTitle : normalized.title
  const hint = normalized.kind === 'unknown' && fallbackTitle ? UNKNOWN.hint : normalized.hint
  return hint ? `${title}\n${hint}` : title
}

export function userError(error: unknown, fallbackTitle?: string): string {
  return formatUserError(error, fallbackTitle)
}

export function fieldErrors(error: unknown): Record<string, string> | undefined {
  return normalizeError(error).fields
}

export function logAppError(error: unknown, context?: string): void {
  const normalized = normalizeError(error)
  const payload = {
    context,
    code: normalized.code,
    status: normalized.status,
    requestId: normalized.requestId,
    technical: normalized.technicalMessage,
    kind: normalized.kind,
  }
  if (import.meta.env.DEV) {
    console.warn('[app-error]', payload, error)
    return
  }
  console.error('[app-error]', payload.code, payload.status, payload.requestId ?? '')
}

export type ApiErrorBody = {
  error?: {
    code?: string
    message?: string
    request_id?: string
    details?: Record<string, unknown>
  }
}

export function payloadFromResponse(data: unknown, status: number): {
  code: string
  message: string
  status: number
  details?: Record<string, unknown>
  requestId?: string
  technicalMessage: string
} {
  const body = (data ?? {}) as ApiErrorBody
  const err = body.error
  const technical = typeof err?.message === 'string' ? err.message : ''
  const code = typeof err?.code === 'string' && err.code ? err.code : 'error'
  const details = err?.details && typeof err.details === 'object' ? err.details : undefined
  const requestId = typeof err?.request_id === 'string' ? err.request_id : undefined
  const normalized = normalizeError({
    code,
    status,
    message: technical,
    details,
    requestId,
    technicalMessage: technical,
  })
  return {
    code: normalized.code,
    message: formatNormalized(normalized),
    status,
    details,
    requestId,
    technicalMessage: technical,
  }
}
