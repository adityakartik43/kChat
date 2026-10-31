export type ConnectionStatus =
  | "PENDING"
  | "ACCEPTED"
  | "DECLINED"
  | "BLOCKED";

export type ConversationType = "DIRECT" | "GROUP";
export type MessageType = "TEXT" | "IMAGE" | "FILE" | "SYSTEM";
export type ParticipantRole = "OWNER" | "ADMIN" | "MEMBER";

export interface PublicUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  connectNumber: string;
  connectNumberFormatted?: string;
  lastSeenAt: string;
}

export interface Profile extends PublicUser {
  email: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface AuthPayload {
  user: Profile;
  tokens: AuthTokens;
}

export interface Connection {
  id: string;
  status: ConnectionStatus;
  createdAt: string;
  requester: PublicUser;
  addressee: PublicUser;
}

export interface LookupResult {
  user: PublicUser;
  connectionState: { status: ConnectionStatus | "NONE"; outgoing: boolean };
  isSelf: boolean;
}

export interface Participant {
  role: ParticipantRole;
  lastReadAt: string | null;
  isMuted: boolean;
  user: PublicUser;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string | null;
  avatarUrl: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  createdAt: string;
  participantCount: number;
  participants: Participant[];
  isMuted?: boolean;
  lastReadAt?: string | null;
  unreadCount?: number;
}

export interface Message {
  id: string;
  conversationId: string;
  body: string;
  type: MessageType;
  clientId: string | null;
  replyToId: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  sender: PublicUser;
  readBy: Array<{ userId: string; readAt: string }>;
}

export interface ConversationWithPeer extends Conversation {
  peer?: PublicUser;
}

// ---------------------------------------------------------------- calls ----

export type CallKind = "AUDIO" | "VIDEO";

export type CallStatus =
  | "RINGING"
  | "ACCEPTED"
  | "ENDED_BY_CALLER"
  | "ENDED_BY_CALLEE"
  | "DECLINED"
  | "MISSED"
  | "FAILED";

export interface Call {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  kind: CallKind;
  status: CallStatus;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  createdAt: string;
  /** Seconds connected, or null when the call was never answered. */
  durationSeconds: number | null;
  peer: PublicUser;
}
