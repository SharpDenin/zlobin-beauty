import { describe, expect, it } from 'vitest'
import { formatUserError, normalizeError, payloadFromResponse } from './app-error'

describe('normalizeError', () => {
  it('maps a known domain code', () => {
    const n = normalizeError({
      code: 'appointment_time_conflict',
      status: 409,
      message: 'selected time is not available',
    })
    expect(n.kind).toBe('conflict')
    expect(n.title).toBe('Это время уже занято')
    expect(n.hint).toContain('другое время')
    expect(formatUserError(n)).toContain('Это время уже занято')
  })

  it('maps procedure_order_invalid with a Russian reason', () => {
    const n = normalizeError({
      code: 'procedure_order_invalid',
      status: 409,
      message: 'сначала стрижка, затем окрашивание',
      details: { hint: 'сначала стрижка, затем окрашивание' },
    })
    expect(n.title).toBe('Такой порядок процедур недоступен')
    expect(n.hint).toContain('сначала стрижка')
    expect(formatUserError(n)).not.toMatch(/procedure_order/i)
  })

  it('maps services_different_salon', () => {
    const n = normalizeError({ code: 'services_different_salon', status: 409, message: 'services belong to different salons' })
    expect(n.title).toBe('Нельзя объединить услуги в одну запись')
    expect(formatUserError(n)).toContain('одного салона')
  })

  it('maps appointment_not_reschedulable without leaking booking_mode', () => {
    const n = normalizeError({
      code: 'appointment_not_reschedulable',
      status: 409,
      message: 'fixed_window appointments cannot be rescheduled',
    })
    expect(n.title).toBe('Эту запись нельзя перенести')
    expect(formatUserError(n)).not.toMatch(/fixed_window/i)
  })

  it('does not show an unknown technical code to the user', () => {
    const n = normalizeError({
      code: 'PARSE_ERROR',
      status: 500,
      message: 'PostgresException SQLSTATE 23505',
    })
    expect(n.title).toBe('Сервис временно недоступен')
    expect(n.hint).toBeTruthy()
    expect(formatUserError(n)).not.toMatch(/PARSE_ERROR|Postgres|SQLSTATE/i)
  })

  it('falls back from HTTP status when code is generic', () => {
    expect(normalizeError({ code: 'error', status: 404, message: 'nope' }).kind).toBe('not_found')
    expect(normalizeError({ code: 'error', status: 403, message: 'nope' }).kind).toBe('authorization')
    expect(normalizeError({ code: 'error', status: 401, message: 'nope' }).kind).toBe('authentication')
    expect(normalizeError({ code: 'error', status: 409, message: 'nope' }).kind).toBe('conflict')
    expect(normalizeError({ code: 'error', status: 422, message: 'nope' }).kind).toBe('validation')
    expect(normalizeError({ code: 'error', status: 429, message: 'nope' }).kind).toBe('rate_limited')
    expect(normalizeError({ code: 'error', status: 503, message: 'nope' }).kind).toBe('server')
  })

  it('maps network failures without Failed to fetch', () => {
    const n = normalizeError(new TypeError('Failed to fetch'))
    expect(n.kind).toBe('network')
    expect(n.code).toBe('network_error')
    expect(formatUserError(n)).toContain('Нет подключения')
    expect(formatUserError(n)).toContain('Проверьте интернет')
    expect(formatUserError(n)).not.toMatch(/Failed to fetch/i)
  })

  it('keeps safe local Russian validation messages', () => {
    const n = normalizeError({
      code: 'validation_error',
      status: 400,
      message: 'Сначала создайте профиль мастера',
    })
    expect(n.title).toBe('Сначала создайте профиль мастера')
  })

  it('maps field-level details', () => {
    const n = normalizeError({
      code: 'validation_error',
      status: 400,
      message: 'validation failed',
      details: { fields: { name: 'Укажите название услуги', price_minor: 'Стоимость должна быть больше 0.' } },
    })
    expect(n.fields?.name).toBe('Укажите название услуги')
    expect(n.hint).toContain('Название')
    expect(n.hint).toContain('Стоимость')
  })

  it('maps invalid credentials by code, not raw English', () => {
    const text = formatUserError({ code: 'invalid_credentials', status: 401, message: 'invalid credentials' })
    expect(text).toContain('Неверный email или пароль')
    expect(text).not.toMatch(/invalid credentials/i)
  })

  it('maps shop checkout conflicts without HTTP or SQL', () => {
    const price = normalizeError({
      code: 'price_changed',
      status: 409,
      message: 'цена изменилась: Estel Essex. Обновите корзину и подтвердите оформление.',
    })
    expect(price.title).toBe('Цена товара изменилась')
    expect(price.hint).toContain('подтвердите новую цену')
    expect(formatUserError(price)).not.toMatch(/409|SQL|error\.response/i)

    const stock = normalizeError({
      code: 'insufficient_stock',
      status: 409,
      message: 'Недостаточно товара на складе',
    })
    expect(stock.title).toBe('Товара недостаточно на складе')
    expect(formatUserError(stock)).toContain('Уменьшите количество')

    const legacyStock = normalizeError({
      code: 'conflict',
      status: 409,
      message: 'insufficient out of stock at location',
    })
    expect(legacyStock.code).toBe('insufficient_stock')
    expect(legacyStock.title).toBe('Товара недостаточно на складе')
  })

  it('uses unknown copy when nothing matches', () => {
    const text = formatUserError(undefined, 'Не удалось сохранить услугу')
    expect(text).toContain('Не удалось сохранить услугу')
    expect(text).toContain('Попробуйте ещё раз')
  })
})

describe('payloadFromResponse', () => {
  it('humanizes API envelope by code', () => {
    const p = payloadFromResponse(
      { error: { code: 'media_unsupported_type', message: 'unsupported content type', request_id: 'r1' } },
      400,
    )
    expect(p.code).toBe('media_unsupported_type')
    expect(p.message).toContain('формат файла не поддерживается')
    expect(p.message).toContain('JPG')
    expect(p.requestId).toBe('r1')
    expect(p.technicalMessage).toBe('unsupported content type')
  })
})
