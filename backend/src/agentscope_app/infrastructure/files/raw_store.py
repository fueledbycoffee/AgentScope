"""Content-addressed, immutable storage of uploaded bytes on the filesystem."""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path
from typing import BinaryIO

from agentscope_app.application.dto import StoredFile


class FilesystemRawFileStore:
    """Files live at ``<root>/<sha[:2]>/<sha>``; writing the same bytes twice is a no-op."""

    def __init__(self, root: Path) -> None:
        self._root = Path(root)

    def _path(self, sha256: str) -> Path:
        if len(sha256) != 64 or not all(c in "0123456789abcdef" for c in sha256):
            raise FileNotFoundError(sha256)
        return self._root / sha256[:2] / sha256

    def put(self, data: bytes) -> StoredFile:
        sha256 = hashlib.sha256(data).hexdigest()
        target = self._path(sha256)
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp_name = tempfile.mkstemp(dir=target.parent, prefix=".upload-")
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(data)
                os.replace(tmp_name, target)  # atomic: readers never see a partial file
            except BaseException:
                Path(tmp_name).unlink(missing_ok=True)
                raise
        return StoredFile(sha256, len(data), str(target))

    def get(self, sha256: str) -> StoredFile | None:
        try:
            target = self._path(sha256)
        except FileNotFoundError:
            return None
        if not target.exists():
            return None
        return StoredFile(sha256, target.stat().st_size, str(target))

    def open(self, sha256: str) -> BinaryIO:
        target = self._path(sha256)
        if not target.exists():
            raise FileNotFoundError(sha256)
        return target.open("rb")
