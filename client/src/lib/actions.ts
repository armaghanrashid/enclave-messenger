import { EventType, type MatrixClient } from 'matrix-js-sdk'

/** Room-level actions shared by the chat and feed screens. */

export async function sendEdit(client: MatrixClient, roomId: string, targetId: string, text: string) {
  await client.sendEvent(roomId, EventType.RoomMessage, {
    msgtype: 'm.text',
    body: `* ${text}`,
    'm.new_content': { msgtype: 'm.text', body: text },
    'm.relates_to': { rel_type: 'm.replace', event_id: targetId },
  } as never)
}

export async function toggleReaction(
  client: MatrixClient,
  roomId: string,
  targetId: string,
  key: string,
  myReactionId?: string,
) {
  if (myReactionId) {
    await client.redactEvent(roomId, myReactionId)
    return
  }
  await client.sendEvent(roomId, 'm.reaction' as never, {
    'm.relates_to': { rel_type: 'm.annotation', event_id: targetId, key },
  } as never)
}

export const ENCRYPTED_ROOM_STATE = [
  {
    type: EventType.RoomEncryption,
    state_key: '',
    content: { algorithm: 'm.megolm.v1.aes-sha2' },
  },
]
