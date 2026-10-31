/**
 * End-to-end test for the CONNECT chat API.
 *
 * Requires a running API and a migrated database:
 *   docker run -d --name connect-pg -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_USER=postgres -e POSTGRES_DB=connect_chat -p 55432:5432 postgres:16-alpine
 *   npx prisma migrate deploy
 *   npm run start:prod
 *   node test/e2e/run.mjs
 *
 * Exits non-zero on the first failure.
 */
import { io } from 'socket.io-client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const BASE_URL = process.env.API_URL ?? 'http://localhost:4000';
const WS_URL = process.env.WS_URL ?? BASE_URL;

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Direct database handle, used only where the HTTP API cannot express the
 * state under test. Ageing a ringing call past its 45s timeout is the one
 * case: the timeout is deliberately handled opportunistically when history is
 * read, with no background worker, so the only way to reach it without waiting
 * three quarters of a minute is to move the row's clock.
 *
 * Everything else in this suite goes through the API on purpose — see the
 * header comment.
 */
let db = null;

function database() {
  if (db) return db;
  const env = {};
  for (const line of readFileSync(join(backendRoot, '.env'), 'utf8').split(
    '\n',
  )) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed
      .slice(eq + 1)
      .replace(/^["']|["']$/g, '');
  }
  db = new pg.Client({ connectionString: env.DATABASE_URL });
  return db;
}

/** Backdate a call by `seconds` so it looks like it has been ringing that long. */
async function ageCall(callId, seconds) {
  const client = database();
  if (!client._connected) {
    await client.connect();
    await client.query(`SET search_path TO chat, public`);
  }
  await client.query(
    `UPDATE chat.calls SET "createdAt" = now() - ($1 || ' seconds')::interval WHERE id = $2`,
    [String(seconds), callId],
  );
}

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    failures.push(name);
    console.log(
      `  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` -> ${detail}` : ''}`,
    );
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  return { status: response.status, body: json };
}

const unique = Date.now();
const alice = {};
const bob = {};
const carol = {};

/** Waits for a socket event, rejecting after `timeout` ms. */
function waitFor(socket, event, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeout);

    function handler(payload) {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }

    socket.on(event, handler);
  });
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = io(WS_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });

    const timer = setTimeout(
      () => reject(new Error('socket connect timeout')),
      8000,
    );

    socket.on('connection:ready', () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.on('auth:error', (payload) => {
      clearTimeout(timer);
      reject(new Error(payload?.message ?? 'socket auth failed'));
    });

    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const ack = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    // Nest reports gateway handler failures on an "exception" event and
    // never calls the ack, so race the two to surface the real reason.
    const onException = (error) => {
      clearTimeout(timer);
      socket.off('exception', onException);
      reject(new Error(`${event} failed: ${JSON.stringify(error)}`));
    };

    const timer = setTimeout(
      () => reject(new Error(`ack timeout for "${event}"`)),
      8000,
    );

    socket.on('exception', onException);

    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      socket.off('exception', onException);
      resolve(response);
    });
  });

async function main() {
  console.log(`\x1b[1mRunning E2E against ${BASE_URL}\x1b[0m`);

  section('Health');
  const health = await api('/health');
  check(
    'GET /health returns 200',
    health.status === 200,
    `got ${health.status}`,
  );
  check(
    'health reports ok',
    health.body?.status === 'ok',
    JSON.stringify(health.body),
  );

  section('Registration and private numbers');
  const aliceReg = await api('/auth/register', {
    method: 'POST',
    body: {
      email: `alice.${unique}@example.com`,
      password: 'sup3r-secret-pw',
      name: 'Alice',
    },
  });
  check(
    'alice registers',
    aliceReg.status === 201,
    JSON.stringify(aliceReg.body),
  );
  alice.id = aliceReg.body?.user?.id;
  alice.email = aliceReg.body?.user?.email;
  alice.number = aliceReg.body?.user?.connectNumber;
  alice.token = aliceReg.body?.tokens?.accessToken;
  alice.refresh = aliceReg.body?.tokens?.refreshToken;

  const bobReg = await api('/auth/register', {
    method: 'POST',
    body: {
      email: `bob.${unique}@example.com`,
      password: 'sup3r-secret-pw',
      name: 'Bob',
    },
  });
  check('bob registers', bobReg.status === 201, JSON.stringify(bobReg.body));
  bob.id = bobReg.body?.user?.id;
  bob.number = bobReg.body?.user?.connectNumber;
  bob.token = bobReg.body?.tokens?.accessToken;
  bob.refresh = bobReg.body?.tokens?.refreshToken;

  const carolReg = await api('/auth/register', {
    method: 'POST',
    body: {
      email: `carol.${unique}@example.com`,
      password: 'sup3r-secret-pw',
      name: 'Carol',
    },
  });
  carol.id = carolReg.body?.user?.id;
  carol.number = carolReg.body?.user?.connectNumber;
  carol.token = carolReg.body?.tokens?.accessToken;

  check(
    'private number is 10 digits',
    /^\d{10}$/.test(alice.number ?? ''),
    alice.number,
  );
  check(
    'private numbers are unique',
    alice.number !== bob.number,
    `${alice.number} vs ${bob.number}`,
  );

  const dupe = await api('/auth/register', {
    method: 'POST',
    body: {
      email: `alice.${unique}@example.com`,
      password: 'sup3r-secret-pw',
      name: 'Alice Again',
    },
  });
  check(
    'duplicate email rejected with 409',
    dupe.status === 409,
    `got ${dupe.status}`,
  );

  const weak = await api('/auth/register', {
    method: 'POST',
    body: {
      email: `weak.${unique}@example.com`,
      password: 'short',
      name: 'Weak',
    },
  });
  check(
    'short password rejected with 400',
    weak.status === 400,
    `got ${weak.status}`,
  );

  const badLogin = await api('/auth/login', {
    method: 'POST',
    body: { email: alice.email, password: 'wrong-password' },
  });
  check(
    'wrong password rejected with 401',
    badLogin.status === 401,
    `got ${badLogin.status}`,
  );

  section('Access control');
  const noAuth = await api('/conversations');
  check(
    'protected route without token returns 401',
    noAuth.status === 401,
    `got ${noAuth.status}`,
  );

  const badToken = await api('/conversations', { token: 'not-a-real-token' });
  check(
    'protected route with bad token returns 401',
    badToken.status === 401,
    `got ${badToken.status}`,
  );

  const me = await api('/auth/me', { token: alice.token });
  check(
    'GET /auth/me returns profile',
    me.status === 200 && me.body?.email === alice.email,
    JSON.stringify(me.body),
  );
  check(
    'profile includes private number',
    me.body?.connectNumber === alice.number,
    me.body?.connectNumber,
  );

  section('Connecting by private number');
  const lookupRaw = await api(`/connections/lookup?number=${bob.number}`, {
    token: alice.token,
  });
  check(
    'lookup by raw number finds bob',
    lookupRaw.status === 200 && lookupRaw.body?.user?.id === bob.id,
    JSON.stringify(lookupRaw.body),
  );

  const formatted = bob.number.replace(/^(\d{4})(\d{4})(\d{2})$/, '$1-$2-$3');
  const lookupFormatted = await api(
    `/connections/lookup?number=${encodeURIComponent(formatted)}`,
    { token: alice.token },
  );
  check(
    'lookup by formatted number finds bob',
    lookupFormatted.body?.user?.id === bob.id,
    JSON.stringify(lookupFormatted.body),
  );

  const lookupMissing = await api('/connections/lookup?number=0000000000', {
    token: alice.token,
  });
  check(
    'unknown number returns 404',
    lookupMissing.status === 404,
    `got ${lookupMissing.status}`,
  );

  const lookupShort = await api('/connections/lookup?number=123', {
    token: alice.token,
  });
  check(
    'malformed number returns 400',
    lookupShort.status === 400,
    `got ${lookupShort.status}`,
  );

  const selfLookup = await api(`/connections/lookup?number=${alice.number}`, {
    token: alice.token,
  });
  check(
    'looking up own number flags isSelf',
    selfLookup.body?.isSelf === true,
    JSON.stringify(selfLookup.body),
  );

  const earlyStart = await api('/conversations/direct', {
    method: 'POST',
    token: alice.token,
    body: { userId: bob.id },
  });
  check(
    'cannot chat before connecting returns 403',
    earlyStart.status === 403,
    `got ${earlyStart.status}`,
  );

  const request = await api('/connections', {
    method: 'POST',
    token: alice.token,
    body: { connectNumber: bob.number },
  });
  check(
    'alice sends connection request',
    request.status === 201,
    JSON.stringify(request.body),
  );
  const connectionId = request.body?.id;

  const reRequest = await api('/connections', {
    method: 'POST',
    token: alice.token,
    body: { connectNumber: bob.number },
  });
  check(
    'duplicate request returns 409',
    reRequest.status === 409,
    `got ${reRequest.status}`,
  );

  const selfRequest = await api('/connections', {
    method: 'POST',
    token: alice.token,
    body: { connectNumber: alice.number },
  });
  check(
    'self connection request rejected with 400',
    selfRequest.status === 400,
    `got ${selfRequest.status}`,
  );

  const wrongResponder = await api(`/connections/${connectionId}`, {
    method: 'PATCH',
    token: alice.token,
    body: { status: 'ACCEPTED' },
  });
  check(
    'requester cannot accept own request',
    wrongResponder.status === 403,
    `got ${wrongResponder.status}`,
  );

  const accepted = await api(`/connections/${connectionId}`, {
    method: 'PATCH',
    token: bob.token,
    body: { status: 'ACCEPTED' },
  });
  check(
    'bob accepts request',
    accepted.status === 200 && accepted.body?.status === 'ACCEPTED',
    JSON.stringify(accepted.body),
  );

  section('Direct conversation');
  const conv = await api('/conversations/direct', {
    method: 'POST',
    token: alice.token,
    body: { userId: bob.id },
  });
  check(
    'alice starts direct conversation',
    conv.status === 201,
    JSON.stringify(conv.body),
  );
  const conversationId = conv.body?.id;
  check(
    'conversation has 2 participants',
    conv.body?.participantCount === 2,
    String(conv.body?.participantCount),
  );

  const convAgain = await api('/conversations/direct', {
    method: 'POST',
    token: alice.token,
    body: { userId: bob.id },
  });
  check(
    'direct conversation is idempotent',
    !!conversationId && convAgain.body?.id === conversationId,
    `${convAgain.body?.id}`,
  );

  const convCarol = await api('/conversations/direct', {
    method: 'POST',
    token: alice.token,
    body: { userId: carol.id },
  });
  check(
    'cannot chat with unconnected user',
    convCarol.status === 403,
    `got ${convCarol.status}`,
  );

  const carolPeek = await api(`/conversations/${conversationId}`, {
    token: carol.token,
  });
  check(
    'non-member cannot read conversation',
    carolPeek.status === 404,
    `got ${carolPeek.status}`,
  );

  const carolMessages = await api(`/conversations/${conversationId}/messages`, {
    token: carol.token,
  });
  check(
    'non-member cannot read messages',
    carolMessages.status === 404,
    `got ${carolMessages.status}`,
  );

  section('Realtime messaging over WebSocket');
  const aliceSocket = await connectSocket(alice.token);
  const bobSocket = await connectSocket(bob.token);
  check('alice socket connected', aliceSocket.connected);
  check('bob socket connected', bobSocket.connected);

  const badSocket = await connectSocket('garbage-token').then(
    () => false,
    () => true,
  );
  check('socket rejects an invalid token', badSocket);

  await ack(aliceSocket, 'conversation:join', { conversationId });
  await ack(bobSocket, 'conversation:join', { conversationId });

  const bobGetsMessage = waitFor(bobSocket, 'message:new');
  const sent = await ack(aliceSocket, 'message:send', {
    conversationId,
    body: 'Hey Bob, this is a real-time message',
    clientId: `c-${unique}-1`,
  });
  check(
    'alice send is acked',
    sent?.message?.body === 'Hey Bob, this is a real-time message',
    JSON.stringify(sent),
  );

  const delivered = await bobGetsMessage;
  check(
    'bob receives message in realtime',
    delivered?.message?.body === 'Hey Bob, this is a real-time message',
    JSON.stringify(delivered),
  );
  check(
    'delivered message carries sender',
    delivered?.message?.sender?.id === alice.id,
    JSON.stringify(delivered?.message?.sender),
  );

  const typingSeen = waitFor(bobSocket, 'typing');
  await ack(aliceSocket, 'typing', { conversationId, typing: true });
  const typing = await typingSeen;
  check(
    'bob receives typing indicator',
    typing?.userId === alice.id && typing?.typing === true,
    JSON.stringify(typing),
  );

  const replySeen = waitFor(aliceSocket, 'message:new');
  await ack(bobSocket, 'message:send', {
    conversationId,
    body: 'Got it, works!',
  });
  const reply = await replySeen;
  check(
    'alice receives reply',
    reply?.message?.body === 'Got it, works!',
    JSON.stringify(reply),
  );

  section('Read receipts');
  const readSeen = waitFor(aliceSocket, 'message:read');
  const readAck = await ack(bobSocket, 'message:read', { conversationId });
  check(
    'bob marks conversation read',
    readAck?.count > 0,
    JSON.stringify(readAck),
  );
  const receipt = await readSeen;
  check(
    'alice receives read receipt',
    receipt?.userId === bob.id && receipt?.messageIds?.length > 0,
    JSON.stringify(receipt),
  );

  const history = await api(`/conversations/${conversationId}/messages`, {
    token: bob.token,
  });
  check(
    'history contains both messages',
    history.body?.length === 2,
    `got ${history.body?.length}`,
  );
  check(
    'history is oldest-first',
    history.body?.[0]?.body === 'Hey Bob, this is a real-time message',
    history.body?.[0]?.body,
  );

  section('Idempotency, edit and delete');
  const dupeAck = await ack(aliceSocket, 'message:send', {
    conversationId,
    body: 'Hey Bob, this is a real-time message',
    clientId: `c-${unique}-1`,
  });
  check(
    'resent clientId returns same message',
    dupeAck?.message?.id === sent?.message?.id,
    `${dupeAck?.message?.id} vs ${sent?.message?.id}`,
  );

  const historyAfterDupe = await api(
    `/conversations/${conversationId}/messages`,
    { token: bob.token },
  );
  check(
    'resent clientId did not duplicate',
    historyAfterDupe.body?.length === 2,
    `got ${historyAfterDupe.body?.length}`,
  );

  const editSeen = waitFor(bobSocket, 'message:updated');
  const edited = await ack(aliceSocket, 'message:edit', {
    messageId: sent.message.id,
    body: 'Hey Bob, edited message',
  });
  check(
    'alice edits her message',
    edited?.message?.body === 'Hey Bob, edited message',
    JSON.stringify(edited),
  );
  const editEvent = await editSeen;
  check(
    'bob receives edit event',
    editEvent?.message?.body === 'Hey Bob, edited message',
    JSON.stringify(editEvent),
  );

  const bobEdit = await ack(bobSocket, 'message:edit', {
    messageId: sent.message.id,
    body: 'hijack',
  }).then(
    () => 'allowed',
    () => 'rejected',
  );
  check('bob cannot edit alice message', bobEdit === 'rejected', bobEdit);

  const deleteSeen = waitFor(bobSocket, 'message:deleted');
  const deleted = await ack(aliceSocket, 'message:delete', {
    messageId: sent.message.id,
  });
  check(
    'alice deletes her message',
    deleted?.message?.deleted === true,
    JSON.stringify(deleted),
  );
  const deleteEvent = await deleteSeen;
  check(
    'bob receives delete event',
    deleteEvent?.message?.deleted === true,
    JSON.stringify(deleteEvent),
  );

  const emptyBody = await ack(aliceSocket, 'message:send', {
    conversationId,
    body: '   ',
  }).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, message: error.message }),
  );
  check(
    'whitespace-only message rejected with 400',
    !emptyBody.ok && emptyBody.message.includes('400'),
    JSON.stringify(emptyBody),
  );

  section('Group conversation');
  const group = await api('/conversations/group', {
    method: 'POST',
    token: alice.token,
    body: { title: 'Project Team', memberIds: [bob.id] },
  });
  check(
    'alice creates group',
    group.status === 201,
    JSON.stringify(group.body),
  );
  const groupId = group.body?.id;
  check(
    'group has 2 participants',
    group.body?.participantCount === 2,
    String(group.body?.participantCount),
  );

  const groupUnconnected = await api('/conversations/group', {
    method: 'POST',
    token: alice.token,
    body: { title: 'Bad Group', memberIds: [carol.id] },
  });
  check(
    'cannot add unconnected user to group',
    groupUnconnected.status === 403,
    `got ${groupUnconnected.status}`,
  );

  await ack(bobSocket, 'conversation:join', { conversationId: groupId });
  const groupMessage = waitFor(bobSocket, 'message:new');
  await ack(aliceSocket, 'message:send', {
    conversationId: groupId,
    body: 'Group hello',
  });
  const gm = await groupMessage;
  check(
    'bob receives group message',
    gm?.message?.body === 'Group hello',
    JSON.stringify(gm),
  );

  const memberEdit = await api(`/conversations/${groupId}`, {
    method: 'PATCH',
    token: bob.token,
    body: { title: 'Renamed by member' },
  });
  check(
    'plain member cannot rename group',
    memberEdit.status === 403,
    `got ${memberEdit.status}`,
  );

  const ownerEdit = await api(`/conversations/${groupId}`, {
    method: 'PATCH',
    token: alice.token,
    body: { title: 'Project Team Renamed' },
  });
  check(
    'owner can rename group',
    ownerEdit.status === 200 &&
      ownerEdit.body?.title === 'Project Team Renamed',
    JSON.stringify(ownerEdit.body),
  );

  section('Conversation list and unread counts');
  const list = await api('/conversations', { token: alice.token });
  check(
    'alice sees 2 conversations',
    list.body?.length === 2,
    `got ${list.body?.length}`,
  );
  const directRow = list.body?.find((c) => c.id === conversationId);
  check('list includes direct conversation', directRow !== undefined);
  check(
    'direct conversation has other member',
    directRow?.participants?.some((p) => p.user.id === bob.id),
  );

  const bobList = await api('/conversations', { token: bob.token });
  const unreadTotal = (bobList.body ?? []).reduce(
    (sum, c) => sum + (c.unreadCount ?? 0),
    0,
  );
  check('bob has unread messages', unreadTotal > 0, String(unreadTotal));

  section('Refresh token rotation');
  const refreshed = await api('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: alice.refresh },
  });
  check(
    'refresh returns new tokens',
    refreshed.status === 200 && !!refreshed.body?.tokens?.accessToken,
    JSON.stringify(refreshed.body),
  );

  const replay = await api('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: alice.refresh },
  });
  check(
    'reused refresh token is rejected',
    replay.status === 401,
    `got ${replay.status}`,
  );

  const newToken = refreshed.body?.tokens?.accessToken;
  const meAfterRefresh = await api('/auth/me', { token: newToken });
  check(
    'new access token works',
    meAfterRefresh.status === 200,
    `got ${meAfterRefresh.status}`,
  );

  const logout = await api('/auth/logout', {
    method: 'POST',
    body: { refreshToken: refreshed.body?.tokens?.refreshToken },
  });
  check('logout succeeds', logout.status === 200, `got ${logout.status}`);

  const afterLogout = await api('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: refreshed.body?.tokens?.refreshToken },
  });
  check(
    'refresh after logout is rejected',
    afterLogout.status === 401,
    `got ${afterLogout.status}`,
  );

  // ====================================================================
  // CALLS
  //
  // Exercises the HTTP surface and the gateway signalling. Actual media
  // transport is a browser concern and is covered by the Playwright suite;
  // what matters here is that the server records, authorises and routes
  // correctly.
  // ====================================================================
  section('Calls: authorisation and validation');

  const groupForCall = await api('/conversations/group', {
    method: 'POST',
    token: alice.token,
    body: { title: 'Call Group', memberIds: [bob.id] },
  });
  const groupCallId = groupForCall.body?.id;

  const callInGroup = await api('/calls/start', {
    method: 'POST',
    token: alice.token,
    body: { conversationId: groupCallId, kind: 'VIDEO' },
  });
  check(
    'calls are refused in a group conversation',
    callInGroup.status === 400,
    `got ${callInGroup.status}`,
  );

  const callAsCarol = await api('/calls/start', {
    method: 'POST',
    token: carol.token,
    body: { conversationId, kind: 'AUDIO' },
  });
  check(
    'a non-member cannot start a call',
    callAsCarol.status === 404,
    `got ${callAsCarol.status}`,
  );

  const callBadKind = await api('/calls/start', {
    method: 'POST',
    token: alice.token,
    body: { conversationId, kind: 'HOLOGRAM' },
  });
  check(
    'an unknown call kind is rejected',
    callBadKind.status === 400,
    `got ${callBadKind.status}`,
  );

  const historyNoAuth = await api(`/calls?conversationId=${conversationId}`);
  check(
    'call history requires authentication',
    historyNoAuth.status === 401,
    `got ${historyNoAuth.status}`,
  );

  const historyAsCarol = await api(`/calls?conversationId=${conversationId}`, {
    token: carol.token,
  });
  check(
    'a non-member cannot read call history',
    historyAsCarol.status === 404,
    `got ${historyAsCarol.status}`,
  );

  section('Calls: lifecycle over the gateway');

  // Every call action names the device it came from. One account is many
  // endpoints, and this is how the server learns which two are carrying media
  // as opposed to merely watching the call.
  const aliceDevice = 'device-alice-1';
  const bobDevice = 'device-bob-1';

  const emptyHistory = await api(`/calls?conversationId=${conversationId}`, {
    token: alice.token,
  });
  check(
    'a new conversation has no calls',
    emptyHistory.status === 200 && emptyHistory.body?.length === 0,
    `${emptyHistory.status} ${emptyHistory.body?.length}`,
  );

  // Ring, and confirm the callee is notified.
  const ringing = waitFor(bobSocket, 'call:incoming');
  const startAck = await ack(aliceSocket, 'call:start', {
    conversationId,
    kind: 'VIDEO',
    deviceId: aliceDevice,
  });
  check(
    'call:start returns the created call',
    Boolean(startAck?.call?.id),
    JSON.stringify(startAck).slice(0, 120),
  );
  check(
    'the new call starts in RINGING',
    startAck?.call?.status === 'RINGING',
    startAck?.call?.status,
  );
  check(
    'the new call is a VIDEO call',
    startAck?.call?.kind === 'VIDEO',
    startAck?.call?.kind,
  );
  check(
    'the ack names the callee as the peer',
    startAck?.call?.peer?.id === bob.id,
    startAck?.call?.peer?.id,
  );
  check(
    'the ack echoes the calling device',
    startAck?.callerDeviceId === aliceDevice,
    startAck?.callerDeviceId,
  );

  const callId = startAck?.call?.id;
  const incomingPayload = await ringing;
  check(
    'the callee is notified of an incoming call',
    Boolean(incomingPayload?.call?.id),
    JSON.stringify(incomingPayload).slice(0, 120),
  );
  check(
    'the incoming payload names the caller',
    incomingPayload?.caller?.id === alice.id,
    incomingPayload?.caller?.id,
  );
  check(
    'the incoming payload resolves the peer for the callee',
    incomingPayload?.call?.peer?.id === alice.id,
    incomingPayload?.call?.peer?.id,
  );

  // A third party must not be able to signal into somebody else's call.
  const carolSocket = await connectSocket(carol.token);
  const carolSignal = await ack(carolSocket, 'call:signal', {
    callId,
    type: 'offer',
    data: JSON.stringify({ type: 'offer', sdp: 'v=0' }),
    deviceId: 'device-carol-1',
  }).catch((error) => ({ error: error.message }));
  check(
    'a non-party cannot signal into a call',
    Boolean(carolSignal?.error),
    JSON.stringify(carolSignal).slice(0, 120),
  );
  carolSocket.close();

  // Accept, and confirm the caller is notified with a payload resolved for
  // *them* — the peer of an accept must be the callee, not the caller.
  const acceptEvent = waitFor(aliceSocket, 'call:accepted');
  await ack(bobSocket, 'call:accept', { callId, deviceId: bobDevice });
  const acceptPayload = await acceptEvent;
  check(
    'the caller is told the call was accepted',
    Boolean(acceptPayload?.call?.id),
    JSON.stringify(acceptPayload).slice(0, 120),
  );
  check(
    'the accepted call is ACCEPTED',
    acceptPayload?.call?.status === 'ACCEPTED',
    acceptPayload?.call?.status,
  );
  check(
    'call:accepted resolves the peer as the callee',
    acceptPayload?.call?.peer?.id === bob.id,
    acceptPayload?.call?.peer?.id,
  );
  check(
    'call:accepted names both participating devices',
    acceptPayload?.callerDeviceId === aliceDevice &&
      acceptPayload?.calleeDeviceId === bobDevice,
    `${acceptPayload?.callerDeviceId} ${acceptPayload?.calleeDeviceId}`,
  );

  // Signalling now that the call is live.
  const relayed = waitFor(bobSocket, 'call:signal');
  await ack(aliceSocket, 'call:signal', {
    callId,
    type: 'offer',
    data: JSON.stringify({ type: 'offer', sdp: 'v=0\r\n' }),
    deviceId: aliceDevice,
  });
  const signal = await relayed;
  check(
    'an offer is relayed to the other party',
    signal?.type === 'offer',
    signal?.type,
  );
  check('the relay names the sender', signal?.from === alice.id, signal?.from);
  check(
    'the relay carries the payload',
    typeof signal?.data === 'string',
    String(signal?.data).slice(0, 40),
  );

  const badSignalType = await ack(aliceSocket, 'call:signal', {
    callId,
    type: 'not-a-real-type',
    deviceId: aliceDevice,
  }).catch((error) => ({ error: error.message }));
  check(
    'a relay with an unknown type is rejected',
    Boolean(badSignalType?.error),
    JSON.stringify(badSignalType).slice(0, 100),
  );

  const unknownCall = await ack(aliceSocket, 'call:signal', {
    callId: '00000000-0000-4000-8000-000000000000',
    type: 'offer',
    data: JSON.stringify({ type: 'offer', sdp: 'v=0' }),
    deviceId: aliceDevice,
  }).catch((error) => ({ error: error.message }));
  check(
    'a relay for an unknown call is rejected',
    Boolean(unknownCall?.error),
    JSON.stringify(unknownCall).slice(0, 100),
  );

  // Signalling is a relay, so it must not double as a storage channel.
  const oversized = await ack(aliceSocket, 'call:signal', {
    callId,
    type: 'candidate',
    data: 'x'.repeat(20_001),
    deviceId: aliceDevice,
  }).catch((error) => ({ error: error.message }));
  check(
    'an oversized relay payload is rejected',
    Boolean(oversized?.error),
    JSON.stringify(oversized).slice(0, 100),
  );

  // End it, and confirm the other side is told.
  const endedEvent = waitFor(bobSocket, 'call:ended');
  await ack(aliceSocket, 'call:end', {
    callId,
    reason: 'hangup',
    deviceId: aliceDevice,
  });
  const ended = await endedEvent;
  check(
    'the callee is told the call ended',
    ended?.callId === callId,
    ended?.callId,
  );
  check(
    'the end status is attributed to the caller',
    ended?.status === 'ENDED_BY_CALLER',
    ended?.status,
  );

  const endedHistory = await api(`/calls?conversationId=${conversationId}`, {
    token: alice.token,
  });
  check(
    'history now has one entry',
    endedHistory.body?.length === 1,
    String(endedHistory.body?.length),
  );
  const record = endedHistory.body?.[0];
  check(
    'the record is persisted as a video call',
    record?.kind === 'VIDEO',
    record?.kind,
  );
  check(
    'the record is ended by the caller',
    record?.status === 'ENDED_BY_CALLER',
    record?.status,
  );
  check(
    'the record has a duration',
    typeof record?.durationSeconds === 'number',
    String(record?.durationSeconds),
  );
  check(
    'the record resolves the peer for the viewer',
    record?.peer?.id === bob.id,
    record?.peer?.id,
  );

  const bobHistory = await api(`/calls?conversationId=${conversationId}`, {
    token: bob.token,
  });
  check(
    'the record resolves the peer from the other side too',
    bobHistory.body?.[0]?.peer?.id === alice.id,
    bobHistory.body?.[0]?.peer?.id,
  );

  // A third party must not be able to end somebody else's call.
  const carolEnd = await api('/calls/end', {
    method: 'POST',
    token: carol.token,
    body: { callId },
  });
  check(
    'a non-party cannot end a call',
    carolEnd.status === 403,
    `got ${carolEnd.status}`,
  );

  section('Calls: decline, supersede and expiry');

  const ringing2 = waitFor(bobSocket, 'call:incoming');
  const second = await ack(aliceSocket, 'call:start', {
    conversationId,
    kind: 'AUDIO',
    deviceId: aliceDevice,
  });
  await ringing2;
  const secondId = second?.call?.id;

  await ack(bobSocket, 'call:reject', {
    callId: secondId,
    reason: 'declined',
    deviceId: bobDevice,
  });
  const declineAck = await api(`/calls?conversationId=${conversationId}`, {
    token: alice.token,
  });
  check(
    'a declined call is recorded as DECLINED',
    declineAck.body?.[0]?.id === secondId &&
      declineAck.body?.[0]?.status === 'DECLINED',
    `${declineAck.body?.[0]?.id} ${declineAck.body?.[0]?.status}`,
  );

  // Ringing again must close the previous live call, not leave two rows.
  const ringing3 = waitFor(bobSocket, 'call:incoming');
  await ack(aliceSocket, 'call:start', {
    conversationId,
    kind: 'AUDIO',
    deviceId: aliceDevice,
  });
  await ringing3;
  const superseded = await api(`/calls?conversationId=${conversationId}`, {
    token: alice.token,
  });
  const liveCount = superseded.body?.filter(
    (c) => c.status === 'RINGING',
  ).length;
  check(
    're-ringing leaves exactly one live call',
    liveCount === 1,
    `${liveCount}`,
  );

  // Cancelling a ringing call closes it.
  const cancelAck = await ack(aliceSocket, 'call:cancel', {
    callId: superseded.body?.[0]?.id,
    deviceId: aliceDevice,
  });
  check(
    'call:cancel closes a ringing call',
    cancelAck?.call?.status !== 'RINGING',
    cancelAck?.call?.status,
  );

  // A ringing call older than the timeout is reported as missed when history
  // is read. Ageing it here avoids waiting 45 seconds.
  const stale = await ack(aliceSocket, 'call:start', {
    conversationId,
    kind: 'AUDIO',
    deviceId: aliceDevice,
  });
  const staleId = stale?.call?.id;
  const historyBefore = await api(`/calls?conversationId=${conversationId}`, {
    token: alice.token,
  });
  check(
    'a ringing call is reported as RINGING in history',
    historyBefore.body?.[0]?.status === 'RINGING',
    historyBefore.body?.[0]?.status,
  );

  // Backdate past the 45s timeout, then read history again. There is no
  // background worker, so the *read* is what has to flip the status.
  await ageCall(staleId, 60);
  const aged = await api(`/calls?conversationId=${conversationId}`, {
    token: alice.token,
  });
  check(
    'a call ringing past the timeout is reported as MISSED on read',
    aged.body?.find((c) => c.id === staleId)?.status === 'MISSED',
    JSON.stringify(aged.body?.find((c) => c.id === staleId)?.status),
  );
  check(
    'the expired call is still in history, not deleted',
    aged.body?.some((c) => c.id === staleId),
    'expired call vanished from history',
  );
  check(
    'expiring one call leaves every other row untouched',
    aged.body
      ?.filter((c) => c.id !== staleId)
      .every(
        (c) =>
          c.status === historyBefore.body?.find((p) => p.id === c.id)?.status,
      ) !== false,
    'a sibling call changed status as a side effect of expiry',
  );

  section('Calls: one account, several devices');

  // The reported bug: a call rings on every device of the callee, which is
  // right, but answering it on one left the others ringing forever. They were
  // sent nothing on accept, and because the row was already ACCEPTED the
  // 45-second missed-call sweep could not reach it either — so those tabs
  // stayed wrong until reloaded, not merely for a moment.
  //
  // Second sockets stand in for second devices. The account is the same; the
  // device id is what tells the server they are different endpoints.
  const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Records every call event a device receives, so silence is assertable.
   *
   * The call id lives at the top level for `call:signal` / `call:ended` and
   * under `call.id` for `call:incoming` / `call:outgoing` / `call:accepted`,
   * so both are consulted.
   */
  const recordCalls = (socket) => {
    const log = [];
    const events = [
      'call:incoming',
      'call:outgoing',
      'call:accepted',
      'call:signal',
      'call:ended',
    ];

    for (const event of events) {
      socket.on(event, (payload) => log.push({ event, payload }));
    }

    const matches = (entry, event, callId) =>
      entry.event === event &&
      (entry.payload?.callId ?? entry.payload?.call?.id) === callId;

    return {
      log,
      count: (event, callId) => log.filter((e) => matches(e, event, callId))
        .length,
      find: (event, callId) =>
        log.find((e) => matches(e, event, callId))?.payload,
      of: (event) => log.filter((e) => e.event === event),
    };
  };

  const aliceTablet = await connectSocket(alice.token);
  const bobPhone = await connectSocket(bob.token);
  const bobLaptop = await connectSocket(bob.token);

  const alicePhone = recordCalls(aliceSocket);
  const aliceOther = recordCalls(aliceTablet);
  const bobPhoneLog = recordCalls(bobPhone);
  const bobLaptopLog = recordCalls(bobLaptop);

  const alicePhoneDevice = 'device-alice-1';
  const aliceTabletDevice = 'device-alice-2';
  const bobPhoneDevice = 'device-bob-1';
  const bobLaptopDevice = 'device-bob-2';

  const multi = await ack(aliceSocket, 'call:start', {
    conversationId,
    kind: 'AUDIO',
    deviceId: alicePhoneDevice,
  });
  const multiId = multi?.call?.id;
  await settle();

  check(
    'the call rings on the first device of the callee',
    bobPhoneLog.log.filter((e) => e.event === 'call:incoming').length === 1,
    `${bobPhoneLog.log.filter((e) => e.event === 'call:incoming').length}`,
  );
  check(
    'the call also rings on the callee second device',
    bobLaptopLog.log.filter((e) => e.event === 'call:incoming').length === 1,
    `${bobLaptopLog.log.filter((e) => e.event === 'call:incoming').length}`,
  );
  check(
    "the caller's other devices are told the call is outgoing",
    aliceOther.log.filter(
      (e) => e.event === 'call:outgoing' && e.payload?.call?.id === multiId,
    ).length === 1,
    aliceOther.log.map((e) => e.event).join(','),
  );
  check(
    'the device that placed the call is not sent its own echo',
    alicePhone.log.filter((e) => e.event === 'call:outgoing').length === 0,
    alicePhone.log.map((e) => e.event).join(','),
  );

  // Answer on one device only.
  await ack(bobPhone, 'call:accept', {
    callId: multiId,
    deviceId: bobPhoneDevice,
  });
  await settle();

  const laptopAccepted = bobLaptopLog.find('call:accepted', multiId);
  check(
    'the answering device is told the call was accepted',
    Boolean(bobPhoneLog.find('call:accepted', multiId)),
    bobPhoneLog.log.map((e) => e.event).join(','),
  );
  check(
    'the callee other device is told it was answered elsewhere',
    Boolean(laptopAccepted),
    bobLaptopLog.log.map((e) => e.event).join(','),
  );
  check(
    'that notification names the device that answered',
    laptopAccepted?.calleeDeviceId === bobPhoneDevice,
    laptopAccepted?.calleeDeviceId,
  );
  check(
    'that notification also names the calling device',
    laptopAccepted?.callerDeviceId === alicePhoneDevice,
    laptopAccepted?.callerDeviceId,
  );
  check(
    'the answer resolves the peer for the callee second device',
    laptopAccepted?.call?.peer?.id === alice.id,
    laptopAccepted?.call?.peer?.id,
  );
  check(
    'the caller side is told too',
    Boolean(alicePhone.find('call:accepted', multiId)),
    alicePhone.log.map((e) => e.event).join(','),
  );
  check(
    "the caller's other device is told as well",
    Boolean(aliceOther.find('call:accepted', multiId)),
    aliceOther.log.map((e) => e.event).join(','),
  );

  // Media must reach one device, not every device the peer has open.
  await ack(aliceSocket, 'call:signal', {
    callId: multiId,
    type: 'offer',
    data: JSON.stringify({ type: 'offer', sdp: 'v=0-multi\r\n' }),
    deviceId: alicePhoneDevice,
  });
  await settle();

  check(
    'an offer reaches the device that answered',
    bobPhoneLog.find('call:signal', multiId)?.type === 'offer',
    JSON.stringify(bobPhoneLog.find('call:signal', multiId)).slice(0, 80),
  );
  check(
    'an offer does not reach the peer bystander device',
    bobLaptopLog.count('call:signal', multiId) === 0,
    `${bobLaptopLog.count('call:signal', multiId)}`,
  );

  // The answer travelling the other way, which is the case that used to fan
  // out to every tab the caller had open.
  await ack(bobPhone, 'call:signal', {
    callId: multiId,
    type: 'answer',
    data: JSON.stringify({ type: 'answer', sdp: 'v=0-answer\r\n' }),
    deviceId: bobPhoneDevice,
  });
  await settle();

  check(
    'an answer reaches the device that offered',
    alicePhone.find('call:signal', multiId)?.type === 'answer',
    alicePhone.log.map((e) => e.event).join(','),
  );
  check(
    "an answer does not reach the caller's other device",
    aliceOther.count('call:signal', multiId) === 0,
    `${aliceOther.count('call:signal', multiId)}`,
  );
  check(
    'no caller-side device negotiated a second time',
    alicePhone.count('call:accepted', multiId) === 1 &&
      aliceOther.count('call:accepted', multiId) === 1,
    `${alicePhone.count('call:accepted', multiId)}/${aliceOther.count('call:accepted', multiId)}`,
  );

  // A second accept, arriving after the first, must be refused. This is the
  // server-side backstop for two devices answering a ring at the same moment.
  const secondAccept = await ack(bobLaptop, 'call:accept', {
    callId: multiId,
    deviceId: bobLaptopDevice,
  }).catch((error) => ({ error: error.message }));
  check(
    'a second device cannot accept an already-answered call',
    Boolean(secondAccept?.error),
    JSON.stringify(secondAccept).slice(0, 100),
  );

  // Hanging up must reach every device of both parties, including the one
  // that acted — previously only the *other* party was told, so the acting
  // user's other tabs kept showing the call.
  await ack(bobPhone, 'call:end', {
    callId: multiId,
    reason: 'hangup',
    deviceId: bobPhoneDevice,
  });
  await settle();

  for (const [label, log] of [
    ['the device that acted', bobPhoneLog],
    ['the other callee device', bobLaptopLog],
    ['the device that was called', alicePhone],
    ['the caller other device', aliceOther],
  ]) {
    check(
      `${label} is told the call ended`,
      log.find('call:ended', multiId)?.status === 'ENDED_BY_CALLEE',
      `${log.find('call:ended', multiId)?.status}`,
    );
  }

  // A bystander tab closing must not end the call; the device carrying the
  // media closing must. The old rule was "does the account have any socket
  // left", which got both cases wrong.
  const ringA = await ack(aliceSocket, 'call:start', {
    conversationId,
    kind: 'AUDIO',
    deviceId: alicePhoneDevice,
  });
  await ack(bobPhone, 'call:accept', {
    callId: ringA?.call?.id,
    deviceId: bobPhoneDevice,
  });
  await settle();

  bobLaptop.close();
  await settle(400);

  const afterBystanderGone = await api(
    `/calls?conversationId=${conversationId}`,
    { token: bob.token },
  );
  check(
    'closing a bystander device leaves the call up',
    afterBystanderGone.body?.find((c) => c.id === ringA?.call?.id)
      ?.status === 'ACCEPTED',
    afterBystanderGone.body?.find((c) => c.id === ringA?.call?.id)?.status,
  );
  check(
    'closing a bystander device does not announce an end',
    bobPhoneLog.count('call:ended', ringA?.call?.id) === 0,
    `${bobPhoneLog.count('call:ended', ringA?.call?.id)}`,
  );
  check(
    'the other side is not told either',
    alicePhone.count('call:ended', ringA?.call?.id) === 0,
    `${alicePhone.count('call:ended', ringA?.call?.id)}`,
  );

  // Now close the device actually carrying media. The account still has
  // another socket, which used to be enough to keep a call ACCEPTED forever
  // with one side talking to nobody.
  await connectSocket(bob.token);
  bobPhone.close();
  await settle(500);

  const afterLegGone = await api(`/calls?conversationId=${conversationId}`, {
    token: bob.token,
  });
  check(
    'closing the device carrying media ends the call',
    afterLegGone.body?.find((c) => c.id === ringA?.call?.id)?.status ===
      'ENDED_BY_CALLEE',
    afterLegGone.body?.find((c) => c.id === ringA?.call?.id)?.status,
  );

  aliceTablet.close();

  section('Validation');
  const badUuid = await api('/conversations/not-a-uuid/messages', {
    token: bob.token,
  });
  check(
    'non-uuid path param returns 400',
    badUuid.status === 400,
    `got ${badUuid.status}`,
  );

  const extraField = await api('/auth/login', {
    method: 'POST',
    body: { email: bob.email, password: 'sup3r-secret-pw', evil: 'x' },
  });
  check(
    'unknown body field rejected with 400',
    extraField.status === 400,
    `got ${extraField.status}`,
  );

  aliceSocket.close();
  bobSocket.close();

  console.log(`\n\x1b[1m${passed} passed, ${failures.length} failed\x1b[0m`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) {
      console.log(`  - ${failure}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('\n\x1b[31mE2E run failed:\x1b[0m', error);
  process.exit(1);
});
