import { useEffect, useState } from 'react'
import { ClientEvent, MatrixEventEvent, RoomEvent, type MatrixClient } from 'matrix-js-sdk'

/** Re-render whenever anything timeline-relevant happens. */
export function useMatrixTick(client: MatrixClient) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    client.on(ClientEvent.Sync, bump)
    client.on(RoomEvent.Timeline, bump)
    client.on(RoomEvent.LocalEchoUpdated, bump)
    client.on(RoomEvent.MyMembership, bump)
    client.on(RoomEvent.Receipt, bump)
    client.on(RoomEvent.Name, bump)
    client.on(MatrixEventEvent.Decrypted, bump)
    return () => {
      client.off(ClientEvent.Sync, bump)
      client.off(RoomEvent.Timeline, bump)
      client.off(RoomEvent.LocalEchoUpdated, bump)
      client.off(RoomEvent.MyMembership, bump)
      client.off(RoomEvent.Receipt, bump)
      client.off(RoomEvent.Name, bump)
      client.off(MatrixEventEvent.Decrypted, bump)
    }
  }, [client])
}
