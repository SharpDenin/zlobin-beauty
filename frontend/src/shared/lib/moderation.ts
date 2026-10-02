/** Client-side UX check. Backend moderation remains the source of truth. */

export const CONTENT_NOT_ALLOWED_MESSAGE =
  'Пожалуйста, измените текст — он содержит запрещённое выражение.'

const LATIN = /\b(?:fuck\w*|shit\w*|bitch\w*|cunt\w*|asshole\w*|motherfuck\w*|whore\w*|slut\w*|bastard|dickhead|nigg(?:a|er)\w*|faggot\w*|retard\w*)\b/i

const CYRILLIC_EXACT = new Set([
  'хуй', 'хуя', 'хуе', 'хуи', 'нахуй', 'похуй', 'охуеть',
  'пизда', 'пиздец', 'пизде', 'пизду',
  'блять', 'блядь', 'бля',
  'сука', 'суки', 'сучка',
  'мудак', 'мудила',
  'пидор', 'пидорас', 'пидрила',
  'гандон', 'гондон',
  'шлюха', 'ублюдок', 'говно', 'дерьмо',
  'идиот', 'дебил', 'кретин', 'придурок', 'тупица',
  'урод', 'тварь', 'мразь', 'сволочь', 'скотина', 'чмо', 'гнида',
  'лох', 'лошара',
])

function foldWord(raw: string) {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\u200b\u200c\u200d\u2060\ufeff\u00ad]/g, '')
}

export function textContainsForbiddenWords(text: string): boolean {
  const value = String(text ?? '').trim()
  if (!value) return false
  if (LATIN.test(value)) return true
  const words = foldWord(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return words.some((w) => CYRILLIC_EXACT.has(w) || [...CYRILLIC_EXACT].some((bad) => w.startsWith(bad) && w.length <= bad.length + 4))
}

export function moderationError(text: string): string | null {
  return textContainsForbiddenWords(text) ? CONTENT_NOT_ALLOWED_MESSAGE : null
}
