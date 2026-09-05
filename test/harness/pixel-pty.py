"""Give the test PTY real pixel geometry before HerdR's initial ioctl handshake."""
import fcntl
import os
import struct
import sys
import termios
from pathlib import Path

mode, path, cols, rows, cell_width, cell_height = sys.argv[1:7]
size = struct.pack('HHHH', int(rows), int(cols), int(cols)*int(cell_width), int(rows)*int(cell_height))
if mode == 'launch':
    fcntl.ioctl(sys.stdout.fileno(), termios.TIOCSWINSZ, size)
    Path(path).write_text(os.ttyname(sys.stdout.fileno()))
    os.execvp(sys.argv[7], sys.argv[7:])
elif mode == 'resize':
    fd = os.open(Path(path).read_text(), os.O_RDWR | os.O_NOCTTY)
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, size)
    finally:
        os.close(fd)
else:
    raise ValueError('Expected launch or resize')
