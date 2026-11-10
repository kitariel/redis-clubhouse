"""Drive the built Ink app through a real terminal on macOS or Linux."""
import errno
import fcntl
import os
import pty
import re
import select
import struct
import subprocess
import termios
import time
from contextlib import contextmanager
from socket import socket
from tempfile import TemporaryDirectory

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
            ['node', 'bin/redis-clubhouse.mjs', *arguments],
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
            decoded = self.output.decode('utf-8', errors='replace')
            clean = CSI.sub('', re.sub(r'\x1b\[(?:2J|3J|H)', '\n', decoded))
            frames = re.split(r'(?m)^ Redis Clubhouse(?=  \|)', clean)
            current = frames[-1]
            if re.search(r'(?m)^ (?:↑↓|Live samples|Chart history)[^\n]+r refresh[^\n]*(?:\n|$)', current) and all(part in current for part in parts):
                return current
            if select.select([self.master], [], [], .1)[0]:
                try:
                    self.output += os.read(self.master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
        raise AssertionError(f'Missing {parts!r} in current terminal frame:\n{current}')


@contextmanager
def local_redis(password=None):
    with TemporaryDirectory(prefix='redis-clubhouse-') as directory:
        with socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = str(listener.getsockname()[1])
        args = ['redis-server', '--bind', '127.0.0.1', '--port', port,
                '--save', '', '--appendonly', 'no', '--dir', directory]
        if password:
            args += ['--requirepass', password]
        server = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            env = {**os.environ, **({'REDISCLI_AUTH': password} if password else {})}

            def command(*args):
                return subprocess.run(['redis-cli', '-h', '127.0.0.1', '-p', port, '--raw', *args],
                                      env=env, capture_output=True, timeout=2)

            for _ in range(100):
                if command('PING').stdout == b'PONG\n':
                    break
                if server.poll() is not None:
                    raise RuntimeError('The isolated test Redis server exited during startup')
                time.sleep(.05)
            else:
                raise RuntimeError('The isolated test Redis server did not start')
            yield port, command
        finally:
            server.terminate()
            server.wait(timeout=5)


os.environ.pop('REDISCLI_AUTH', None)
os.environ.pop('REDIS_USERNAME', None)
with local_redis() as (port, redis):
    assert redis('SET', 'shared', 'value-in-db0').stdout == b'OK\n'
    assert redis('-n', '1', 'SET', 'shared', '{"database":1}', 'EX', '300').stdout == b'OK\n'
    assert redis('-n', '1', 'SET', 'extra', 'value-in-db1').stdout == b'OK\n'
    with Terminal(['localhost:' + port], 110, 32) as term:
        term.expect('Memory used', 'Commands/s', 'db0 *', 'db1', 'Redis memory', 'Connected')
        term.send(b'3')
        chart = term.expect('Redis memory', 'Commands per second', '2 samples')
        assert re.search(r'[\u2801-\u28ff]', chart), chart
        term.send(b'1', DOWN, ENTER)
        term.expect('db1  /  Key explorer', 'Key', 'Type', 'TTL', 'shared', 'extra', 'string')
        term.send(b'/', b'shared', ENTER)
        term.expect('Filter shared', '1 of 1 in batch')
        term.send(ENTER)
        term.expect('Key details', 'Type string', '"database": 1')
        term.send(b'd', b'0', ENTER)
        term.expect('db0  /  Key explorer', 'shared')
        term.send(ENTER)
        term.expect('value-in-db0', 'TTL Persistent')
        term.send(b'd', b'99', ENTER)
        term.expect('database index is out of range')
    assert redis('GET', 'shared').stdout == b'value-in-db0\n'
    assert redis('-n', '1', 'GET', 'shared').stdout == b'{"database":1}\n'

    with Terminal(['127.0.0.1:' + port, '--ascii'], 80, 24) as term:
        term.expect('Databases', 'db0', 'db1')
        term.send(b'2', ENTER)
        term.expect('Key details', 'value-in-db0')
        term.send(ESC)
        term.expect('db0  /  Key explorer', 'shared')
        term.send(b'3')
        chart = term.expect('Redis memory', 'Commands per second', '| ')
        assert '*' in chart, chart

    assert redis('ACL', 'SETUSER', 'clubviewer', 'on', '>test-viewer-password', '~*',
                 '+scan', '+type', '+ttl').stdout == b'OK\n'
    os.environ['REDIS_USERNAME'] = 'clubviewer'
    try:
        with Terminal(['127.0.0.1:' + port], 80, 24) as term:
            term.expect('Redis authentication')
            term.send(b'test-viewer-password', ENTER)
            term.expect('Metrics unavailable', 'Connected')
            term.send(b'2')
            term.expect('shared', 'string', 'Persistent')
            term.send(ENTER)
            term.expect('Type string', 'TTL Persistent', 'Redis denied this read command.')
    finally:
        os.environ.pop('REDIS_USERNAME', None)

with local_redis('test-only-password') as (port, redis):
    assert redis('SET', 'private-key', 'private-value').stdout == b'OK\n'
    with Terminal(['127.0.0.1:' + port], 80, 24) as term:
        term.expect('Redis authentication', 'Password')
        term.send(b'test-only-password')
        assert 'test-only-password' not in term.expect('******************')
        term.send(ENTER)
        term.expect('Connected', 'Databases')
        term.send(b'2', ENTER)
        term.expect('private-value')
        redis('SHUTDOWN', 'NOSAVE')
        term.expect('Disconnected · r retries')

print('Live Redis dashboard, database switching, dot charts, key grid, and authentication passed')
