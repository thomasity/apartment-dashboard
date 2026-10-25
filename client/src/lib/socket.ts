import { io, type Socket } from 'socket.io-client';

// One long-lived connection for the app-wide providers (Spotify, connectivity). Created
// on first use so nothing connects at import time. The Lights tab still opens its own.
let socket: Socket | null = null;

export function getSocket(): Socket {
  socket ??= io({ transports: ['websocket', 'polling'] });
  return socket;
}
