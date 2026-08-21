#!/usr/bin/env python3
"""Scan a PNG for pixels near a target RGB; print count + sample locations."""
import sys
from pngsample import decode

def main():
    path, r, g, b, tol = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
    w, h, ch, data = decode(path)
    hits = []
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            o = (y*w + x) * ch
            pr, pg, pb = data[o], data[o+1], data[o+2]
            if abs(pr-r) <= tol and abs(pg-g) <= tol and abs(pb-b) <= tol:
                hits.append((x, y))
    print('hits: %d' % len(hits))
    for p in hits[:40]:
        print(p, end='  ')
    print()

if __name__ == '__main__':
    main()
