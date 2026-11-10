# Redis Clubhouse

A keyboard-first terminal dashboard for Redis. Connect by hostname or IP, browse logical databases such as `db0` and `db1`, inspect keys and values, and watch memory and command traffic in live time-series charts.

## Quick start

Use Node.js 20.19 or later and a reachable Redis server.

```sh
git clone https://github.com/kitariel/redis-clubhouse.git
cd redis-clubhouse
npm ci
npm run build
npm link
redis-clubhouse localhost:6379
```

Replace `localhost:6379` with your Redis host and port. You can also run `./bin/redis-clubhouse.mjs localhost:6379` directly after building. With a bare hostname the port defaults to 6379. Append `--ascii` for ASCII borders and chart marks.

Use `rediss://cache.example.com:6380/2` for TLS with `db2` selected. Redis Clubhouse prompts for a password when needed. You can set `REDISCLI_AUTH` and, for a named ACL user, `REDIS_USERNAME` in your shell.

## The dashboard

| View | What it shows |
| --- | --- |
| **1 Overview** | Server memory, keys, commands per second, and clients. The database grid shows key counts, expiring keys, and a dot bar for each database. |
| **2 Keys** | A key, type, and TTL grid for the selected database. Open a row for a value preview. |
| **3 Charts** | Connected plots with value and time axes. View Redis memory, commands per second, cache hits and misses per second, and total versus expiring keys. |

Charts use up to 60 live samples taken every two seconds while connected. Green marks memory and cache hits, orange marks commands and expiring keys, red marks misses, and blue marks total keys. Each legend shows the latest reading. Cache rates use the change in Redis counters between samples. Overlapping lines share a light trace. On a smaller terminal, press ←/→ to switch chart pages.

The inspector connects to one standalone Redis server and uses read-only data commands. The database grid uses `INFO` and, where permitted, `CONFIG GET databases` to include the first 256 configured indexes, including empty ones. Higher indexes appear when Redis reports keys in them or when you open them directly. If discovery is restricted, press `d` to enter a database index directly. Restricted metrics and metadata appear as unavailable. String previews read up to 4 KiB, and collections show up to 10 items. Hash previews use Redis 6.2 or later.

## Keyboard

| Key | Action |
| --- | --- |
| 1 / 2 / 3 | Overview, Keys, Charts |
| ↑ / ↓ | Move through databases or keys, or scroll a value |
| Enter | Open the selected database or inspect a key |
| d | Jump to a database index |
| / | Filter keys using a Redis glob, such as `session:*`. Submit an empty filter to clear it. |
| ← / → | Switch chart pages on smaller terminals |
| n / p | Move to the next or previous scan batch |
| Tab | Switch between the key grid and value pane |
| r | Refresh the current keys and server metrics |
| ? / Esc | Open help, go back, or cancel an input |
| q / Ctrl+C | Quit |

## Development

```sh
npm test
npm run build
npm run test:e2e
```

The end-to-end check needs Python 3, `redis-server`, and `redis-cli` on macOS or Linux. It starts its own local Redis server and drives the built app through a pseudo-terminal.
