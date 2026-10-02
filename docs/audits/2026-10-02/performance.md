# Performance of the server and the web application

- Date: 2026-10-02
- Commit read: 2ed7c55

This audit measures the latency and the throughput of the server, and the
load, navigation and typing time of the web application. The findings of the
same day are in [product-audit.md](product-audit.md).

## How the run was made

- One machine ran the server of one worktree, its PostgreSQL and a headless
  Chromium. No network delay was added, so every number is a lower bound for
  a real connection.
- The workspace held 1010 notes: 1000 notes of about 2 KB in 20 folders, one
  note of 50 KB and one of 500 KB. They came in through the import
  operation.
- A server case ran 20 requests to warm up, then 200 timed requests one after
  the other, then 8 seconds at 16 concurrent connections.
- A percentile is the nearest rank of the sorted samples. Each table states
  the number of samples.
- Typing latency is the time from a `keydown` to the task after the next
  animation frame, for 120 keys at 40 ms apart. Event Timing counted the
  `keydown`, `keypress` and `input` entries that took 16 ms or more. One key
  gives up to three entries, so that count can be larger than the keys.
- 4x CPU is the throttle of Chromium. It stands for a mid-range phone.

## Server

| Case                                  | Samples | p50     | p95     | p99     |
| ------------------------------------- | ------- | ------- | ------- | ------- |
| Health                                | 200     | 1.4 ms  | 1.8 ms  | 5.8 ms  |
| Account                               | 200     | 4.7 ms  | 7.9 ms  | 13.2 ms |
| One page of the file list, 100 rows   | 200     | 9.5 ms  | 14.5 ms | 24.2 ms |
| Read a 2 KB note                      | 200     | 4.8 ms  | 7.9 ms  | 10.1 ms |
| Read the 50 KB note                   | 200     | 5.5 ms  | 9.0 ms  | 23.5 ms |
| Read the 500 KB note                  | 60      | 11.6 ms | 25.0 ms | 31.5 ms |
| History of a note                     | 200     | 4.2 ms  | 4.7 ms  | 8.7 ms  |
| Search for a word in every note       | 200     | 60.7 ms | 63.6 ms | 71.9 ms |
| Search for a rare phrase              | 200     | 3.6 ms  | 4.1 ms  | 5.8 ms  |
| Changeset commit, from the server log | 40      | 20.9 ms | 32.9 ms |         |
| Export of the workspace               | 5       | 1462 ms |         |         |

| Case at 16 connections          | Requests per second | p50      | p95      |
| ------------------------------- | ------------------- | -------- | -------- |
| Health                          | 8667                | 1.9 ms   | 2.4 ms   |
| Read a 2 KB note                | 511                 | 30.7 ms  | 36.7 ms  |
| One page of the file list       | 162                 | 97.0 ms  | 109.9 ms |
| Search for a word in every note | 64                  | 264.1 ms | 320.3 ms |

What the server numbers show:

- The full file list takes 11 pages, about 105 ms in sequence.
- A read sends 2.3 to 2.5 times the size of the text: 5.1 KB for a 2 KB note
  and 1.15 MB for the 500 KB note. The answer carries the text and the
  document state.
- Search time grows with the number of matches. A common word costs 17 times
  a rare phrase.

## Load of the web application

| Case                                       | Samples | p50    | p95    |
| ------------------------------------------ | ------- | ------ | ------ |
| Cold start: first contentful paint         | 8       | 416 ms | 424 ms |
| Cold start: the list states the note count | 8       | 880 ms | 890 ms |
| Warm start: first contentful paint         | 10      | 76 ms  | 396 ms |
| Warm start: the list states the note count | 10      | 305 ms | 865 ms |

A cold start is a new device with no HTTP cache, no worker and an empty
IndexedDB. It loads 24 script files: 433 KB compressed and 1.53 MB decoded,
plus 53 KB of fonts and about 93 requests.

## Navigation

| Case                              | Samples | p50     | p95    |
| --------------------------------- | ------- | ------- | ------ |
| Open the command palette          | 20      | 26 ms   | 42 ms  |
| Palette result after the last key | 20      | 16 ms   | 28 ms  |
| Open a 2 KB note from the palette | 20      | 162 ms  | 272 ms |
| Open the 50 KB note               | 5       | 183 ms  | 364 ms |
| Open the 500 KB note              | 5       | 372 ms  | 504 ms |
| Open the 500 KB note at 4x CPU    | 1       | 1267 ms |        |
| From a note to All notes          | 9       | 202 ms  | 230 ms |

One more navigation to All notes took 12.8 s. Its cause is not known.

## Typing

| Note             | Keys | p50     | p95     | p99      | Event entries over 16 ms |
| ---------------- | ---- | ------- | ------- | -------- | ------------------------ |
| 2 KB             | 123  | 10.2 ms | 35.4 ms | 47.1 ms  | 50                       |
| 50 KB            | 123  | 9.7 ms  | 29.4 ms | 33.2 ms  | 43                       |
| 500 KB           | 123  | 12.1 ms | 35.5 ms | 77.6 ms  | 191                      |
| 2 KB at 4x CPU   | 123  | 17.5 ms | 51.9 ms | 190.9 ms | 362                      |
| 500 KB at 4x CPU | 123  | 33.8 ms | 55.7 ms | 263.4 ms | 363                      |

- Each key causes about 18 changes of the page outside the editor.
- At 4x CPU, the session on the 2 KB note held 83 long tasks, 10.4 s in
  total. The run does not separate the work of typing from the background
  sync of 1010 notes.
- The heap grew from 75 MB to 206 MB after the 500 KB note opened.
- Scrolling the 500 KB note held 60 frames per second. At 4x CPU it held 49,
  and the worst frame took 150 ms.

## Save and sync

| Case                                                  | Samples | p50     | p95     |
| ----------------------------------------------------- | ------- | ------- | ------- |
| Ctrl + S to the answer of the server                  | 20      | 280 ms  | 323 ms  |
| Ctrl + S on one device to the text on a second device | 20      | 782 ms  | 802 ms  |
| A pause in typing to the text on a second device      | 5       | 2808 ms | 2887 ms |

- The server commits in about 21 ms, so about 260 ms of a Ctrl + S is spent
  in the client before the request leaves. `documentWorkDelayMs` in
  `apps/web/src/features/editor/note-editor.tsx` is one part of it.
- One run of the second case took 19.4 s. Its cause is not known.
- A pause of 2.5 s before a version is the design of record 0022.

## Reading the numbers

- On a desktop CPU, the median key is inside one frame, but the p95 is two
  frames. The best editors keep the p95 inside one frame.
- At 4x CPU, the p99 key on a short note is close to the 200 ms limit of a
  good Interaction to Next Paint.
- The cold start script is large for a phone on a slow network.
- The server is not the bottleneck of a save. The client is.
