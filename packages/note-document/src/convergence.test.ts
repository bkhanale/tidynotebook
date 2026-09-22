/**
 * Seeded convergence properties over several replicas.
 *
 * Every run states its seed, so a failure repeats exactly. Delivery is
 * unreliable on purpose: an update can arrive twice, out of order, or late,
 * which is what a queue, a feed, and an offline device produce.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactDocument,
  readDocumentText,
  startDocument,
} from './document.ts';
import { observeDocument } from './observed.ts';
import { editorBinding } from './editor-bridge.ts';
import { openDocumentSession, type DocumentSession } from './session.ts';

/** The transaction origin that the CodeMirror binding gives local input. */
const bindingOrigin = { binding: 'convergence' };

/** Writes into a session the way the bound editor does. */
function write(
  session: DocumentSession,
  change: (text: ReturnType<typeof editorBinding>['text']) => void,
): void {
  const { text } = editorBinding(session);
  text.doc?.transact(() => {
    change(text);
  }, bindingOrigin);
}

/** A small seeded generator, so a failing round repeats. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** One replica with the work it has to send. */
type Replica = {
  readonly session: DocumentSession;
  readonly outbox: Uint8Array[];
};

/** Opens one replica over the starting document. */
function replicaOf(document: Uint8Array): Replica {
  const session = openDocumentSession(document);
  const outbox: Uint8Array[] = [];
  session.subscribe((change) => {
    if (change.origin === 'local') outbox.push(change.update);
  });
  return { session, outbox };
}

/** Writes one random edit into one replica, as a person would. */
function edit(replica: Replica, random: () => number, round: number): void {
  const text = replica.session.text();
  const at = Math.floor(random() * (text.length + 1));
  if (text.length > 0 && random() < 0.4) {
    const length = 1 + Math.floor(random() * Math.min(12, text.length - at));
    if (length > 0) {
      write(replica.session, (text) => {
        text.delete(at, length);
      });
      return;
    }
  }
  const words = ['note ', 'edit ', '\n', 'é ', '\u{1F600} ', 'line\r\n'];
  const word = words[Math.floor(random() * words.length)] ?? 'x';
  write(replica.session, (text) => {
    text.insert(at, `${word}${String(round)} `);
  });
}

await test('replicas that exchange every update reach one text', () => {
  for (const seed of [1, 2, 3, 5, 8, 13, 21]) {
    const random = randomFrom(seed);
    const base = startDocument('start\n');
    const replicas = [replicaOf(base), replicaOf(base), replicaOf(base)];
    /** Updates that wait for delivery, as [target, update] pairs. */
    const flight: [number, Uint8Array][] = [];
    for (let round = 0; round < 40; round += 1) {
      const writer = Math.floor(random() * replicas.length);
      const replica = replicas[writer];
      if (replica === undefined) continue;
      edit(replica, random, round);
      for (const update of replica.outbox.splice(0)) {
        for (let target = 0; target < replicas.length; target += 1) {
          if (target === writer) continue;
          flight.push([target, update]);
          // A feed can deliver the same record twice.
          if (random() < 0.3) flight.push([target, update]);
        }
      }
      // Deliver some of the waiting work now, in an order of its own.
      const delivering = Math.floor(random() * flight.length);
      for (let index = 0; index < delivering; index += 1) {
        const pick = Math.floor(random() * flight.length);
        const entry = flight[pick];
        if (entry === undefined) continue;
        flight.splice(pick, 1);
        const outcome = replicas[entry[0]]?.session.applyRemote(entry[1]);
        // An update that arrives before the work it depends on is refused,
        // and the sender keeps it for a later delivery.
        if (outcome !== undefined && !outcome.ok) {
          assert.equal(outcome.refusal, 'missing-dependency', `seed ${seed}`);
          flight.push(entry);
        }
      }
    }
    // Every replica now receives everything that is left, until nothing
    // waits. A refusal that never clears would loop, so the count bounds it.
    for (let attempt = 0; flight.length > 0; attempt += 1) {
      assert.ok(attempt < 10_000, `seed ${seed} did not settle`);
      const entry = flight.shift();
      if (entry === undefined) break;
      const outcome = replicas[entry[0]]?.session.applyRemote(entry[1]);
      if (outcome !== undefined && !outcome.ok) flight.push(entry);
    }
    for (const replica of replicas)
      for (const update of replica.outbox.splice(0))
        for (const target of replicas)
          if (target !== replica)
            assert.ok(target.session.applyRemote(update).ok);

    const texts = replicas.map((replica) => replica.session.text());
    assert.equal(new Set(texts).size, 1, `seed ${seed}: ${texts.join(' | ')}`);
    // Equal text is not equal state, so the complete observed states are
    // compared as well.
    const states = replicas.map((replica) =>
      Buffer.from(replica.session.observe()).toString('base64'),
    );
    assert.equal(new Set(states).size, 1, `seed ${seed}`);
    for (const replica of replicas) replica.session.destroy();
  }
});

await test('work written before a compaction still converges', () => {
  for (const seed of [4, 7, 11]) {
    const random = randomFrom(seed);
    const base = startDocument('one\ntwo\nthree\n');
    const online = replicaOf(base);
    const offline = replicaOf(base);
    for (let round = 0; round < 10; round += 1) edit(online, random, round);
    for (let round = 0; round < 10; round += 1) edit(offline, random, round);
    // The server compacts everything it has while the other device is away.
    const compacted = compactDocument([base, ...online.outbox.splice(0)]);
    assert.equal(readDocumentText(compacted), online.session.text());

    // The late work applies to the compacted document, and both sides settle.
    const late = offline.outbox.splice(0);
    const server = replicaOf(compacted);
    for (const update of late) assert.ok(server.session.applyRemote(update).ok);
    for (const update of server.outbox.splice(0))
      assert.ok(offline.session.applyRemote(update).ok);
    assert.ok(offline.session.applyRemote(compacted).ok);
    assert.equal(offline.session.text(), server.session.text(), `seed ${seed}`);
    assert.deepEqual(
      observeDocument(offline.session.encode()),
      observeDocument(server.session.encode()),
    );
    for (const replica of [online, offline, server]) replica.session.destroy();
  }
});
