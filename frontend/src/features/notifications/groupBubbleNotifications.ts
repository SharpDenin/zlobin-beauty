export type NotificationRow = {
  id: string
  type: string
  title: string
  body: string
  entity_type: string
  entity_id: string | null
  read_at: string | null
  hidden_at?: string | null
  deleted_at?: string | null
  created_at: string
}

export type BubbleItem = NotificationRow & {
  /** All notification ids collapsed into this bubble (chat groups). */
  groupIds: string[]
  /** Stable UI key — one per conversation or single notification. */
  groupKey: string
  /** Unread message count for chat bubbles; omitted for non-chat. */
  messageCount?: number
}

export function isChatNotification(n: { entity_type?: string | null; type?: string | null }) {
  return n.entity_type === 'conversation' || n.type === 'new_message'
}

export function isAppointmentNotification(n: { entity_type?: string | null }) {
  return n.entity_type === 'appointment'
}

function createdAtMs(n: { created_at: string }) {
  return new Date(n.created_at).getTime() || 0
}

/**
 * Collapse conversation notifications into one bubble per chat.
 * Message count prefers messenger `unread_count` for that conversation.
 * Non-chat notifications stay one-to-one. Result ordered by latest activity.
 */
export function groupBubbleNotifications(
  items: NotificationRow[],
  unreadByConversation: Record<string, number> = {},
): BubbleItem[] {
  const chatGroups = new Map<string, NotificationRow[]>()
  const others: NotificationRow[] = []

  for (const n of items) {
    if (isChatNotification(n) && n.entity_id) {
      const list = chatGroups.get(n.entity_id) ?? []
      list.push(n)
      chatGroups.set(n.entity_id, list)
    } else {
      others.push(n)
    }
  }

  const chatBubbles: BubbleItem[] = []
  for (const [conversationId, group] of chatGroups) {
    const sorted = [...group].sort((a, b) => createdAtMs(b) - createdAtMs(a))
    const latest = sorted[0]
    if (!latest) continue

    const unreadNotifs = sorted.filter((g) => !g.read_at).length
    const hasMessengerCount = Object.prototype.hasOwnProperty.call(unreadByConversation, conversationId)
    const messengerUnread = hasMessengerCount ? unreadByConversation[conversationId] : undefined

    // Messenger is source of truth: fully-read chats drop out of the bubble rail.
    if (messengerUnread === 0) continue

    const messageCount =
      typeof messengerUnread === 'number'
        ? messengerUnread
        : Math.max(unreadNotifs, 1)

    chatBubbles.push({
      ...latest,
      read_at: messageCount > 0 ? null : latest.read_at,
      groupIds: sorted.map((g) => g.id),
      groupKey: `conversation:${conversationId}`,
      messageCount,
    })
  }

  const otherBubbles: BubbleItem[] = others.map((n) => ({
    ...n,
    groupIds: [n.id],
    groupKey: `notification:${n.id}`,
  }))

  return [...chatBubbles, ...otherBubbles].sort((a, b) => createdAtMs(b) - createdAtMs(a))
}
