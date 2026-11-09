"""Drive the built Ink app through a real terminal on macOS or Linux."""
import errno
import fcntl
import os
import pty
import re
import select
import struct
import subprocess
import sys
import termios
import time
from pathlib import Path

CSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
DOWN = b'\x1b[B'
UP = b'\x1b[A'
ENTER = b'\r'
ESC = b'\x1b'


class Terminal:
    def __init__(self, arguments, columns, rows):
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
        self.process = subprocess.Popen(
            ['node', 'bin/termscope.mjs', *arguments],
            stdin=slave, stdout=slave, stderr=slave,
            env={**os.environ, 'TERM': 'xterm-256color', 'CI': 'false'},
        )
        os.close(slave)
        self.output = b''

    def __enter__(self):
        return self

    def __exit__(self, *_):
        try:
            if self.process.poll() is None:
                self.send(b'q')
                self.process.wait(timeout=2)
        except (OSError, AssertionError, subprocess.TimeoutExpired):
            self.process.kill()
            self.process.wait()
        finally:
            os.close(self.master)

    def send(self, *keys):
        # Ink enables raw mode after its first paint. Wait before sending the first key.
        deadline = time.monotonic() + 2
        while termios.tcgetattr(self.master)[3] & termios.ICANON:
            if time.monotonic() >= deadline:
                raise AssertionError('Ink did not enter terminal raw mode')
            if select.select([self.master], [], [], .05)[0]:
                os.read(self.master, 65536)
        self.output = b''
        for key in keys:
            os.write(self.master, key)
            deadline = time.monotonic() + .6
            while time.monotonic() < deadline and select.select([self.master], [], [], .1)[0]:
                try:
                    self.output += os.read(self.master, 65536)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    break

    def expect(self, *parts):
        until = time.monotonic() + 5
        while time.monotonic() < until:
            clean = CSI.sub('', self.output.decode('utf-8', errors='replace'))
            frames = re.split(r'(?m)^ TermScope', clean)
            current = frames[-1]
            if re.search(r'(?m)^ Tab [^\n]+\n', current) and all(part in current for part in parts):
                return current
            if select.select([self.master], [], [], .1)[0]:
                try:
                    self.output += os.read(self.master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
        raise AssertionError(f'Missing {parts!r} in current terminal frame:\n{current}')


before, after, partial, base_url = sys.argv[1:]
with Terminal(['inspect', before, after], 80, 24) as term:
    term.expect('DATABASE EXPLORER', 'sync_queue')
    term.send(b'\t')
    term.expect('Overview', 'Records')
    term.send(b'c')
    term.expect('Comparison', 'sync_queue', '-18')
    term.send(b'/', b'sync_queue', ENTER)
    term.send(ENTER)
    term.expect('Removed keys (18)', 'txn-sync-001')
    term.send(ESC, b'\t')
    term.expect('DATABASE EXPLORER')
    term.send(DOWN, DOWN, DOWN, DOWN, DOWN, ENTER)
    term.expect('18 records', 'txn-sync-001')
    term.send(ENTER)
    term.expect('queued', 'transactions')
    term.send(b'\x1b[6~', ENTER)
    term.expect('posted', 'after.json')

with Terminal(['inspect', partial, after], 110, 32) as term:
    term.expect('DATABASE EXPLORER', 'Overview')
    term.send(b'c', b'/', b'sync_queue', ENTER, ENTER)
    term.expect('Key comparison unavailable.', '-18')

with Terminal(['open', str(Path('samples/sales.http')), '--base-url', base_url, '--ascii'], 110, 32) as term:
    term.expect('press Enter to run')
    term.send(ENTER)
    term.expect('HTTP 200', 'revenue')
    term.send(b'2', b'p')
    term.expect('Pinned chart', 'Jan', 'Feb')
    term.send(b'/', b'East', ENTER)
    updated = term.expect('Pinned chart', 'Jan')
    assert 'Feb' not in updated, updated
    term.send(b'3', DOWN)
    term.expect('Mar', '13,100')
    term.send(b'\t', DOWN, ENTER)
    term.expect('Sales by region', 'HTTP 200', 'region')
    term.send(b'\t', UP)
    term.expect('GET Sales · HTTP 200', 'revenue')

print('Terminal import, comparison, key detail, partial preview, and live REST chart passed')
