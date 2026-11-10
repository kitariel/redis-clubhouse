# TermScope

TermScope is a keyboard-first terminal inspector for Redis, IndexedDB snapshots, and REST responses. Connect directly to a Redis server to browse keys, types, TTLs, and value previews. The static browser demo supports IndexedDB snapshots and bundled REST examples.

## Run it locally

Use Node.js 20.19+ and npm.

```sh
git clone https://github.com/kitariel/redis-clubhouse.git
cd redis-clubhouse
npm ci
npm run build
npm link
termscope redis localhost:6379
```

Replace `localhost:6379` with the hostname or IP of a reachable Redis server. The default port is 6379. The Redis view uses read-only commands and works with a standalone Redis server. For TLS and database selection, use a URL such as `rediss://cache.example.com:6380/2`.

Press ↑/↓ to choose a key, Enter to open its details, and Esc to return to the key list. Press `/` to search the selected database with a Redis glob such as `session:*`, `n` or `p` to move between batches, and `r` to refresh. Press `?` for help. String previews read up to 4 KiB, and collection previews show up to 10 items. Hash previews use Redis 6.2 or later.

If the server requires authentication, TermScope prompts for a password. You can also set `REDISCLI_AUTH` in your local environment, and use `REDIS_USERNAME` for a named ACL user.

You can also invoke `./bin/termscope.mjs redis localhost:6379` after building. Append `--ascii` for ASCII borders and chart marks.

## IndexedDB and REST

```sh
termscope demo
termscope inspect samples/before.json samples/after.json
termscope open samples/sales.http --base-url http://localhost:3000
```

Run `npm run preview` and open the local URL to see the production browser build. Use `npm run dev` while editing the browser app. The browser starts with the sample IndexedDB overview and includes bundled sales responses under **REST**.

## Capture IndexedDB from your app

Build TermScope, then copy the standalone `dist/capture.mjs` into your app’s development assets. Import it from the app that already has open database handles. The helper uses one read-only transaction per database and never opens, upgrades, or closes the supplied handles.

```js
import { downloadSnapshot } from './capture.mjs'

// Run this from a development button or from app code with access to the open handles.
await downloadSnapshot([ledgerDb], {
  maxKeys: 50,
  includeValues: true,
  maxValues: 10,
  maxValueBytes: 4096,
})
```

Capture once before the sync and again after it finishes. Use `captureSnapshot(handles, options)` if you want the object without starting a download. Each database has its own transaction, so captures across several databases are taken independently.

Values are opt-in. By default the helper captures at most 50 keys per store. When values are enabled, it captures at most 10 values per store, each up to 4,096 UTF-8 bytes after JSON encoding. Unsupported values and values over the limit get placeholders. Snapshots can contain sensitive keys and values. Keep real captures local.

Import both files with **Import snapshots** in the browser or pass both paths to `termscope inspect`. The browser reads files locally. Imports and downloads accept up to 20 MiB per snapshot. Reduce the preview limits if a download exceeds that size.

Press `c` to compare. In the terminal, `o` opens the before/after selectors. In the sample captures, `sync_queue` goes from 18 to 0. Open the before capture’s `sync_queue`, inspect `"txn-sync-001"`, and open its matching entry in the after capture’s `transactions` store.

## Snapshot format v1

See [before.json](samples/before.json) and [after.json](samples/after.json) for full examples.

| Object | Fields |
| --- | --- |
| Snapshot | `schemaVersion: 1`, canonical site `origin`, ISO `capturedAt`, `databases`, optional `storage` |
| Database | `name`, positive integer `version`, `stores` |
| Store | `name`, `keyPath` (string, string array, or null), `autoIncrement`, `count` (nonnegative integer or null), `indexes`, `keys`, `keysComplete`, optional `values` |
| Index | `name`, `keyPath` (string or string array), `unique`, `multiEntry`, optional `entries` and `distinctKeys` |
| Key | String, finite number, array of keys, or tagged object. Dates use `{"type":"date","value":"2026-05-14T10:12:00.000Z"}`. Binary keys use `{"type":"binary","value":"00ff"}`. Infinite numeric keys use `{"type":"number","value":"Infinity"}` or `"-Infinity"` as the value. |
| Value preview | `{key, value}` with a key from the key preview. If the value is omitted, `value` is null and `omitted` describes why. A captured JSON null has no `omitted` field. |
| Storage | Optional `usage` and `quota` bytes. Both are browser estimates for the entire origin. |

A store count of `0` means empty. A `null` count means unavailable. `keysComplete: false` means some keys may be missing from the capture. The helper reads the total with `count()` and the preview with a key cursor. Index entry and distinct-key statistics can be supplied by a snapshot producer, and are separate from store record counts.

Comparisons use origin, database name, and store name. Newly present and missing stores are labeled. Key additions and removals require two complete previews for the same store. Store timelines use a gap when a count is unavailable or the store is absent.

## REST files

Separate requests with `###` and optionally put the request name after the separator. Each request starts with `METHOD URL`. Put headers on subsequent lines and separate an optional body with a blank line.

```http
### Sales
GET /sales
Accept: application/json
Authorization: Bearer {{SALES_TOKEN}}
```

Use an absolute HTTP(S) URL or pass `--base-url` for relative paths. Set variables in your local shell environment before opening the file. Enter runs the focused request in the terminal. Press `x` to cancel the active request. The timeout is 10 seconds and the decoded response limit is 2 MiB. Redirect responses are shown directly.

Use **Raw** to read the response and **Table** to browse arrays of objects. Options (`o`) lets you select an array path, X field, numeric Y field, and bar or line chart. Table filtering and sorting feed the chart. Press `p` to pin the chart below the table at approximately 110 × 32 cells.

## Keyboard

| Key | Terminal |
| --- | --- |
| Tab / Shift+Tab | Switch between source and workspace. At 80 × 24, the focused pane fills the body. |
| ↑ / ↓ and Page Up / Page Down | Move through sources, rows, chart points, or text |
| ← / → | Focus a column or change an option |
| Enter | Open a store, inspect a key, run a request, or confirm options |
| 1–5 | IndexedDB overview, keys, indexes, charts, comparison |
| 1–3 | REST raw, table, chart |
| / | Edit the filter. Enter applies and Esc reverts. |
| s | Sort the focused column and toggle direction |
| c / o / p | Compare captures / open view options / pin the chart |
| ? / Esc | Open help / close the overlay |
| q / Ctrl+C | Quit |

The browser uses native Tab navigation and visible focus. Buttons, table sort headers, selectors, and chart points work by keyboard or pointer. The numbered view shortcuts, `/`, `c`, `p`, and `?` also work outside editable controls.

## Verify and publish

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The end-to-end check uses Chromium to populate and capture a test app’s IndexedDB. It imports the same JSON in the browser and terminal, checks the queue comparison and partial preview handling, then runs real requests against a local HTTP server and checks that a table filter updates the chart. The terminal check needs Python 3 and a macOS or Linux pseudo-terminal. Set `TERMSCOPE_CHROMIUM_CHANNEL=chrome` to use an existing Google Chrome installation.

Publish the contents of `dist/` to a static host. The build uses relative asset URLs and works at a GitHub Pages project path. In GitHub, choose **Settings → Pages → GitHub Actions**, then configure a Pages workflow to run `npm ci` and `npm run build`, upload `dist/` with `actions/upload-pages-artifact`, and deploy it with `actions/deploy-pages`. Open the Pages URL after deployment. For a local check, use `npm run preview` to serve the build over HTTP.

## Source layout

- `src/core/` defines snapshot capture and validation, comparison, and data preparation for both clients.
- `src/terminal/` renders the Ink app and executes REST requests.
- `src/web/` renders the static demo and handles local file imports.
- `samples/` contains the bundled before/after captures and an example request file.
