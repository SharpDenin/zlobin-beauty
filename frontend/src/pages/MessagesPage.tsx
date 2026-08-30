import { useNavigate, useParams } from 'react-router-dom'
import { MessengerApp } from '@/features/messenger/MessengerApp'

export { openConversation } from '@/features/messenger/api'
export type { Conversation, ChatMessage } from '@/features/messenger/types'

export function MessagesPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  return (
    <main className="page messenger-page">
      <h1 className="visually-hidden">Сообщения</h1>
      <MessengerApp
        mode="page"
        conversationId={id}
        onSelectConversation={(next) => {
          void navigate(next ? `/messages/${next}` : '/messages')
        }}
      />
    </main>
  )
}
