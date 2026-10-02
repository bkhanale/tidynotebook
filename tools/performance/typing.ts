/**
 * Measures typing in the note editor: the time from a key to the next frame,
 * and the changes of the page outside the editor that each key causes.
 *
 * Usage: `pnpm perf:typing`, which builds, installs the browser of the
 * `testing-changes-end-to-end` skill and runs this file. Pass `--keys <n>` to
 * type another number of keys per case, and `--cases <names>` with names such
 * as `2 KB,500 KB` to run some cases only.
 *
 * The run starts the built application on a new database, seeds the corpus
 * of `samples.ts`, opens one device and waits until it holds every note. Then
 * each case opens a note, waits until the device is quiet, and types plain
 * keys 40 ms apart, as the audit of 2026-10-02 did:
 *
 * - latency is the time from the `keydown` of a key to the task after the
 *   next animation frame, which is when the frame that shows the key is done;
 * - outside mutations are the records of one `MutationObserver` on the whole
 *   document whose target is not inside `.cm-editor`, given to the key that
 *   came last before them, and the records of the quiet time after the last
 *   key are counted apart;
 * - Event Timing counts the `keydown`, `keypress` and `input` entries of 16 ms
 *   or more, and the long task observer counts tasks over 50 ms;
 * - 4x CPU is the throttle of Chromium, which stands for a mid-range phone.
 *
 * Every number it prints is a measured result for the report of the run.
 */
import process from 'node:process';
import {
  awaitNoteCount,
  launchChromium,
  notesBeforeSeed,
  openDevice,
  pause,
  report,
  seedCorpus,
  signInApi,
  startApplication,
  type Device,
  type SeededNote,
} from './browser.ts';
import { distribution } from './samples.ts';

/** What the probe of one case collects inside the page. */
type TypingProbe = {
  readonly latencies: number[];
  readonly outsideByKey: number[];
  readonly targets: Record<string, number>;
  readonly typingTargets: Record<string, number>;
  readonly longTasks: number[];
  idleOutside: number;
  typing: boolean;
  slowEventCount: number;
  stop: () => void;
};

declare global {
  interface Window {
    notesappTypingProbe?: TypingProbe;
  }
}

/** The plain keys that a case types, one after the other. */
const keyText = 'the quick brown fox jumps over the lazy dog ';
/** The gap between two keys, as a fast typist leaves it. */
const keyGapMs = 40;
/** The quiet time after the last key, longer than the pause of a version. */
const idleMs = 4000;

const keysArgument = process.argv.indexOf('--keys');
const keysPerCase =
  keysArgument === -1 ? 120 : Number(process.argv[keysArgument + 1]);
if (!Number.isInteger(keysPerCase) || keysPerCase < 1)
  throw new Error('--keys takes a positive whole number.');

/** Installs the observers of one case inside the page. */
function installProbe(): void {
  const probe: TypingProbe = {
    latencies: [],
    outsideByKey: [],
    targets: {},
    typingTargets: {},
    longTasks: [],
    idleOutside: 0,
    typing: true,
    slowEventCount: 0,
    stop: () => {},
  };
  const describe = (node: Node, kind: string, attribute: string | null) => {
    const element = node instanceof Element ? node : node.parentElement;
    const place =
      element?.closest(
        'aside, footer, nav, header, [role=status], [role=toolbar], [data-save-state]',
      ) ?? null;
    const placeName =
      place === null
        ? 'page'
        : `${place.tagName.toLowerCase()}${place.getAttribute('aria-label') === null ? '' : `[${place.getAttribute('aria-label') ?? ''}]`}`;
    const target = element === null ? 'none' : element.tagName.toLowerCase();
    return `${placeName} ${target} ${kind}${attribute === null ? '' : `:${attribute}`}`;
  };
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      const element =
        record.target instanceof Element
          ? record.target
          : record.target.parentElement;
      if (element?.closest('.cm-editor') != null) continue;
      if (probe.typing) {
        const last = probe.outsideByKey.length - 1;
        if (last >= 0)
          probe.outsideByKey[last] = (probe.outsideByKey[last] ?? 0) + 1;
      } else probe.idleOutside += 1;
      const key = describe(record.target, record.type, record.attributeName);
      probe.targets[key] = (probe.targets[key] ?? 0) + 1;
      if (probe.typing)
        probe.typingTargets[key] = (probe.typingTargets[key] ?? 0) + 1;
    }
  });
  mutations.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!probe.typing) return;
    const started = event.timeStamp;
    probe.outsideByKey.push(0);
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        probe.latencies.push(performance.now() - started);
      };
      channel.port2.postMessage(null);
    });
  };
  window.addEventListener('keydown', onKeyDown, true);
  const events = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (
        probe.typing &&
        (entry.name === 'keydown' ||
          entry.name === 'keypress' ||
          entry.name === 'input') &&
        entry.duration >= 16
      )
        probe.slowEventCount += 1;
  });
  // Event Timing takes a threshold that the DOM library does not name yet.
  const eventOptions: PerformanceObserverInit & {
    readonly durationThreshold: number;
  } = { type: 'event', durationThreshold: 16 };
  events.observe(eventOptions);
  const tasks = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (probe.typing) probe.longTasks.push(entry.duration);
  });
  tasks.observe({ type: 'longtask' });
  probe.stop = () => {
    mutations.disconnect();
    events.disconnect();
    tasks.disconnect();
    window.removeEventListener('keydown', onKeyDown, true);
  };
  window.notesappTypingProbe = probe;
}

/** Puts the focus in the text of the open note. */
function focusEditor(): void {
  const content = document.querySelector('.cm-content');
  if (!(content instanceof HTMLElement))
    throw new Error('The note shows no editor.');
  content.focus();
}

/** Ends the typing part of a case: later records count as idle. */
function endTyping(): void {
  const probe = window.notesappTypingProbe;
  if (probe !== undefined) probe.typing = false;
}

/** Reads what the probe collected and removes it. */
function collectProbe(): {
  readonly latencies: readonly number[];
  readonly outsideByKey: readonly number[];
  readonly idleOutside: number;
  readonly targets: Record<string, number>;
  readonly typingTargets: Record<string, number>;
  readonly slowEvents: number;
  readonly longTasks: readonly number[];
} {
  const probe = window.notesappTypingProbe;
  if (probe === undefined) throw new Error('The typing probe is missing.');
  probe.stop();
  delete window.notesappTypingProbe;
  return {
    latencies: probe.latencies,
    outsideByKey: probe.outsideByKey,
    idleOutside: probe.idleOutside,
    targets: probe.targets,
    typingTargets: probe.typingTargets,
    slowEvents: probe.slowEventCount,
    longTasks: probe.longTasks,
  };
}

/** Types plain keys into the open note, each `keyGapMs` after the last. */
async function typeKeys(device: Device, count: number): Promise<void> {
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    const due = started + index * keyGapMs;
    const wait = due - performance.now();
    if (wait > 0) await pause(wait);
    await device.page.keyboard.type(keyText[index % keyText.length] ?? 'a');
  }
}

/** One case: a note and a CPU throttle. */
type TypingCase = {
  readonly name: string;
  readonly note: SeededNote;
  readonly cpuRate: number;
};

/** Opens the note of a case, types into it and reads the probe. */
async function runCase(device: Device, item: TypingCase) {
  await device.page.goto(
    new URL(
      `/w/${device.workspaceId}/notes/${item.note.fileId}`,
      device.page.url(),
    ).href,
  );
  await device.page.locator('.cm-content').waitFor({ timeout: 60_000 });
  // A click on the text could land on a link, which opens it (record 0075),
  // so the caret goes in through focus and the end key.
  await device.page.evaluate(focusEditor, undefined);
  await device.page.keyboard.press('Control+End');
  await device.page.keyboard.press('Enter');
  // The open of a note reads the outline, the backlinks and the history. A
  // case starts after that work, so it measures typing alone.
  await pause(idleMs);
  const cdp = await device.context.newCDPSession(device.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: item.cpuRate });
  await device.page.evaluate(installProbe, undefined);
  await typeKeys(device, keysPerCase);
  await device.page.evaluate(endTyping, undefined);
  await pause(idleMs * item.cpuRate);
  const probe = await device.page.evaluate(collectProbe, undefined);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const outside = probe.outsideByKey.reduce((sum, value) => sum + value, 0);
  const topTargets = Object.entries(probe.targets)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([target, count]) => ({ target, count }));
  return {
    case: item.name,
    keys: probe.outsideByKey.length,
    latencyMs: distribution(probe.latencies),
    outsideMutationsPerKey:
      Math.round((outside / Math.max(1, probe.outsideByKey.length)) * 100) /
      100,
    keysWithOutsideMutations: probe.outsideByKey.filter((value) => value > 0)
      .length,
    outsideMutationsAfterTyping: probe.idleOutside,
    eventEntriesOver16Ms: probe.slowEvents,
    longTasks: {
      count: probe.longTasks.length,
      totalMs: Math.round(
        probe.longTasks.reduce((sum, value) => sum + value, 0),
      ),
    },
    topTargets,
    typingTargets: Object.entries(probe.typingTargets)
      .sort((left, right) => right[1] - left[1])
      .map(([target, count]) => ({ target, count })),
  };
}

const app = await startApplication();
try {
  const session = await signInApi(app);
  const before = await notesBeforeSeed(app, session);
  const notes = await seedCorpus(app, session);
  const browser = await launchChromium();
  try {
    const device = await openDevice(browser, app);
    await awaitNoteCount(device, before + notes.length);
    const small = notes.find((note) => note.path.endsWith('note-0001.md'));
    const large = notes.find((note) => note.path === 'large/large-note.md');
    const huge = notes.find((note) => note.path === 'large/huge-note.md');
    if (small === undefined || large === undefined || huge === undefined)
      throw new Error('The corpus lacks a note of a case.');
    const cases: TypingCase[] = [
      { name: '2 KB', note: small, cpuRate: 1 },
      { name: '50 KB', note: large, cpuRate: 1 },
      { name: '500 KB', note: huge, cpuRate: 1 },
      { name: '2 KB at 4x CPU', note: small, cpuRate: 4 },
      { name: '500 KB at 4x CPU', note: huge, cpuRate: 4 },
    ];
    const casesAt = process.argv.indexOf('--cases');
    const chosen =
      casesAt === -1
        ? cases
        : cases.filter((item) =>
            (process.argv[casesAt + 1] ?? '').split(',').includes(item.name),
          );
    const results = [];
    for (const item of chosen) results.push(await runCase(device, item));
    report({
      environment: {
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
      },
      notes: before + notes.length,
      keysPerCase,
      keyGapMs,
      results,
      problems: device.problems,
    });
  } finally {
    await browser.close();
  }
} finally {
  await app.stop();
}
