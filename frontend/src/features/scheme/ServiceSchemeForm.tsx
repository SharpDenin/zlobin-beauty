import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '@/shared/api/client'

export type SchemeField = {
  key: string
  label: string
  type: string
  required: boolean
}

export type SchemeTemplate = {
  id: string
  category_key: string
  version: number
  name: string
  fields: SchemeField[]
}

type Props = {
  appointmentId: string
  accessToken: string | null
  disabled?: boolean
  fieldValues: Record<string, string>
  onFieldChange: (key: string, value: string) => void
  technique: string
  onTechniqueChange: (value: string) => void
  notes: string
  onNotesChange: (value: string) => void
  productName: string
  onProductNameChange: (value: string) => void
  productQty: string
  onProductQtyChange: (value: string) => void
  proportion: string
  onProportionChange: (value: string) => void
}

export function ServiceSchemeForm({
  appointmentId,
  accessToken,
  disabled,
  fieldValues,
  onFieldChange,
  technique,
  onTechniqueChange,
  notes,
  onNotesChange,
  productName,
  onProductNameChange,
  productQty,
  onProductQtyChange,
  proportion,
  onProportionChange,
}: Props) {
  const templateQuery = useQuery({
    queryKey: ['scheme-template', appointmentId],
    queryFn: () =>
      apiRequest<{ exists: boolean; name?: string; fields?: SchemeField[] }>(
        `/v1/appointments/${appointmentId}/scheme-template`,
        { token: accessToken },
      ),
    enabled: Boolean(appointmentId && accessToken),
  })

  const fields = templateQuery.data?.fields ?? []
  const [validation, setValidation] = useState<Record<string, string>>({})

  useEffect(() => {
    setValidation({})
  }, [fieldValues, technique, productName])

  const showProductRow = useMemo(
    () => fields.some((f) => f.key === 'dye' || f.key === 'product') || templateQuery.data?.exists === false,
    [fields, templateQuery.data?.exists],
  )

  if (templateQuery.isLoading) {
    return <div className="state-box">Загрузка шаблона схемы…</div>
  }

  return (
    <div className="stack scheme-form" data-testid="service-scheme-form">
      {templateQuery.data?.name && (
        <p className="muted">
          Шаблон: <strong>{templateQuery.data.name}</strong>
        </p>
      )}
      {fields.map((field) => {
        if (field.key === 'technique') {
          return (
            <div className="field" key={field.key}>
              <label htmlFor={`scheme-${field.key}`}>
                {field.label}
                {field.required && ' *'}
              </label>
              <input
                id={`scheme-${field.key}`}
                value={technique}
                disabled={disabled}
                onChange={(e) => onTechniqueChange(e.target.value)}
                placeholder={field.label}
              />
              {validation[field.key] && <span className="error">{validation[field.key]}</span>}
            </div>
          )
        }
        const value = fieldValues[field.key] ?? ''
        return (
          <div className="field" key={field.key}>
            <label htmlFor={`scheme-${field.key}`}>
              {field.label}
              {field.required && ' *'}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                id={`scheme-${field.key}`}
                value={value}
                disabled={disabled}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
              />
            ) : (
              <input
                id={`scheme-${field.key}`}
                value={value}
                disabled={disabled}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
                placeholder={field.label}
              />
            )}
            {validation[field.key] && <span className="error">{validation[field.key]}</span>}
          </div>
        )
      })}
      {showProductRow && (
        <>
          <div className="field">
            <label htmlFor="scheme-product">Продукт / материал</label>
            <input
              id="scheme-product"
              value={productName}
              disabled={disabled}
              onChange={(e) => onProductNameChange(e.target.value)}
              placeholder="Majirel 7.1"
            />
          </div>
          <div className="row scheme-form-row">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="scheme-qty">Количество</label>
              <input
                id="scheme-qty"
                value={productQty}
                disabled={disabled}
                onChange={(e) => onProductQtyChange(e.target.value)}
                placeholder="30"
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="scheme-proportion">Пропорция</label>
              <input
                id="scheme-proportion"
                value={proportion}
                disabled={disabled}
                onChange={(e) => onProportionChange(e.target.value)}
                placeholder="1:1.5"
              />
            </div>
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="scheme-notes">Заметки</label>
        <input id="scheme-notes" value={notes} disabled={disabled} onChange={(e) => onNotesChange(e.target.value)} />
      </div>
    </div>
  )
}

export function buildCategoryFields(
  fields: SchemeField[] | undefined,
  fieldValues: Record<string, string>,
  technique: string,
): Record<string, string> {
  const out: Record<string, string> = { ...fieldValues }
  if (fields?.some((f) => f.key === 'technique')) {
    out.technique = technique
  }
  return out
}

export function mapValidationError(message: string, fields: SchemeField[]): string {
  for (const f of fields) {
    if (message.includes(f.label)) {
      return `Заполните поле «${f.label}»`
    }
  }
  if (message.includes('product') || message.includes('material')) {
    return 'Укажите продукт или материал'
  }
  return message
}
