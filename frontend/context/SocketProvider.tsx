"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { getSocketUrl, getAccessToken } from "@/lib/api";
import { useAuth } from "./AuthProvider";

export interface TypingState {
  conversationId: string;
  userId: string;
  typing: boolean;
}

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
  /** userId -> online, maintained from presence broadcasts. */
  onlineUsers: Set<string>;
  /** conversationId -> userIds currently typing. */
  typingUsers: Map<string, Set<string>>;
  isOnline: (userId: string) => boolean;
  isTyping: (conversationId: string, userId: string) => boolean;
  emitTyping: (conversationId: string, typing: boolean) => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<Map<string, Set<string>>>(new Map());
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!user) {
      /* eslint-disable react-hooks/set-state-in-effect --
       * Teardown on sign-out: drop the live socket and clear every map that
       * was populated from its events, so a later user never sees stale
       * presence or typing state. */
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
      setOnlineUsers(new Set());
      setTypingUsers(new Map());
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    const token = getAccessToken();

    if (!token) return;

    const instance = io(getSocketUrl(), {
      path: "/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionAttempts: Infinity,
    });

    socketRef.current = instance;
    setSocket(instance);

    instance.on("connect", () => setConnected(true));

    instance.on("disconnect", () => setConnected(false));

    instance.on("connect_error", () => setConnected(false));

    instance.on("presence:update", (payload: { userId: string; online: boolean }) => {
      setOnlineUsers((previous) => {
        const next = new Set(previous);

        if (payload.online) next.add(payload.userId);
        else next.delete(payload.userId);

        return next;
      });
    });

    instance.on("typing", (payload: TypingState) => {
      setTypingUsers((previous) => {
        const next = new Map(previous);
        const current = new Set(next.get(payload.conversationId) ?? []);

        if (payload.typing) current.add(payload.userId);
        else current.delete(payload.userId);

        if (current.size === 0) next.delete(payload.conversationId);
        else next.set(payload.conversationId, current);

        return next;
      });
    });

    return () => {
      instance.removeAllListeners();
      instance.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [user]);

  const isOnline = useCallback(
    (userId: string) => onlineUsers.has(userId),
    [onlineUsers],
  );

  const isTyping = useCallback(
    (conversationId: string, userId: string) =>
      typingUsers.get(conversationId)?.has(userId) ?? false,
    [typingUsers],
  );

  const emitTyping = useCallback((conversationId: string, typing: boolean) => {
    socketRef.current?.emit("typing", { conversationId, typing });
  }, []);

  const value = useMemo<SocketContextValue>(
    () => ({
      socket,
      connected,
      onlineUsers,
      typingUsers,
      isOnline,
      isTyping,
      emitTyping,
    }),
    [socket, connected, onlineUsers, typingUsers, isOnline, isTyping, emitTyping],
  );

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
}

export function useSocket(): SocketContextValue {
  const context = useContext(SocketContext);

  if (!context) {
    throw new Error("useSocket must be used inside SocketProvider");
  }

  return context;
}
