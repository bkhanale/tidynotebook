/**
 * The frame boundary of every WebSocket channel of `asyncapi.yaml`.
 *
 * An HTTP response hook cannot see a frame after an upgrade, so the server
 * reads every received frame and checks every sent message here (record
 * 0126). Both directions use the validators that `src/validators.ts` compiles
 * from the same schema components that Hey API types for the client.
 *
 * A refusal names its reason and the failed members by JSON Pointer. It never
 * copies a value of the frame, so a log line cannot carry a workspace or a
 * secret that a client sent.
 */
import type {
  ChannelEntry,
  ChannelId,
  ClientMessageKind,
  MessageDirection,
} from './generated/contract.ts';
import { channels } from './generated/contract.ts';
import { describeIssues, type ValidationIssue } from './schema.ts';
import { messageKey, messageValidators } from './validators.ts';

/** Why a frame is not a message of its channel. */
export type MessageRefusalReason =
  'not_json' | 'not_object' | 'unknown_kind' | 'invalid';

/** A frame that is not a message of its channel. */
export type MessageRefusal = {
  readonly ok: false;
  readonly reason: MessageRefusalReason;
  readonly issues: readonly ValidationIssue[];
};

/** A client message that matched its schema. */
export type ClientMessage = {
  readonly ok: true;
  readonly kind: ClientMessageKind;
  /** The members of the message, which its schema accepted. */
  readonly message: Readonly<Record<string, unknown>>;
};

const byId = new Map<string, ChannelEntry>(
  channels.map((channel) => [channel.id, channel]),
);

/** The channel with this id, or undefined when the contract has no such id. */
export function findChannel(id: string): ChannelEntry | undefined {
  return byId.get(id);
}

function refusal(
  reason: MessageRefusalReason,
  issues: readonly ValidationIssue[] = [],
): MessageRefusal {
  return { ok: false, reason, issues };
}

function isClientKind(
  channel: ChannelEntry,
  kind: string,
): kind is ClientMessageKind {
  return channel.messages.some(
    (message) => message.kind === kind && message.direction === 'client',
  );
}

/** The members of a JSON object, or null for any other value. */
function membersOf(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return null;
  return Object.fromEntries(Object.entries(value));
}

/** Validates one message of one direction, or names why it failed. */
function check(
  channel: ChannelEntry,
  direction: MessageDirection,
  value: unknown,
): MessageRefusal | { readonly ok: true; readonly kind: string } {
  const members = membersOf(value);
  if (members === null) return refusal('not_object');
  const kind = members.kind;
  if (typeof kind !== 'string') return refusal('unknown_kind');
  const validate = messageValidators.get(
    messageKey(channel.id, direction, kind),
  );
  if (validate === undefined) return refusal('unknown_kind');
  if (!validate(value))
    return refusal('invalid', describeIssues(validate.errors));
  return { ok: true, kind };
}

/**
 * Reads one frame that a client sent on a channel.
 *
 * Only a message that the channel lists in the client direction is accepted,
 * so a client cannot send a notice of the server.
 */
export function readClientMessage(
  id: ChannelId,
  frame: string,
): ClientMessage | MessageRefusal {
  const channel = byId.get(id);
  if (channel === undefined)
    throw new Error(`The contract has no channel ${id}.`);
  let value: unknown;
  try {
    value = JSON.parse(frame);
  } catch {
    return refusal('not_json');
  }
  const checked = check(channel, 'client', value);
  if (!checked.ok) return checked;
  const members = membersOf(value);
  if (members === null || !isClientKind(channel, checked.kind))
    return refusal('unknown_kind');
  return { ok: true, kind: checked.kind, message: members };
}

/**
 * Checks one message that the server is about to send on a channel.
 *
 * Returns null when the message matches its schema. A message that does not
 * is a server defect, and the caller sends nothing.
 */
export function checkServerMessage(
  id: ChannelId,
  message: unknown,
): MessageRefusal | null {
  const channel = byId.get(id);
  if (channel === undefined)
    throw new Error(`The contract has no channel ${id}.`);
  const checked = check(channel, 'server', message);
  return checked.ok ? null : checked;
}

/**
 * Stops startup when the handlers of a channel and its client messages differ.
 *
 * A server serves each message that a client can send, and nothing else, so
 * a new message in the contract cannot reach a server that ignores it.
 */
export function assertMessageHandlers(
  id: ChannelId,
  handled: readonly string[],
): void {
  const channel = byId.get(id);
  if (channel === undefined)
    throw new Error(`The contract has no channel ${id}.`);
  const declared: readonly string[] = channel.messages
    .filter((message) => message.direction === 'client')
    .map((message) => message.kind);
  const failures = [
    ...declared
      .filter((kind) => !handled.includes(kind))
      .map((kind) => `Missing handler for message ${kind} of ${id}.`),
    ...handled
      .filter((kind) => !declared.includes(kind))
      .map((kind) => `Handler ${kind} has no client message in ${id}.`),
  ];
  if (failures.length > 0) throw new Error(failures.join('\n'));
}
