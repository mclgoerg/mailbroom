"""Runs INSIDE Pyodide (build.mjs feeds it), because the .pyc files have to
carry the magic number of the exact CPython the browser runs.

`pack(src_dir, dst_zip, dfile_root, compile_py)` writes a reproducible zip of
`src_dir`: sorted entries, fixed timestamps, deflate level 9; with `compile_py`
every .py becomes a sourceless unchecked-hash .pyc at the same path (the
importer takes it as is: no stat, no source, no __pycache__ write at import).
`repack_wheel(src, dst, dfile_root)` does the same to a wheel's contents."""

import ast
import importlib.util
import zipfile
from importlib._bootstrap_external import _code_to_hash_pyc
from pathlib import Path

EPOCH = (1980, 1, 1, 0, 0, 0)


_SCOPES = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)


def _drop_docstrings(tree: ast.AST) -> ast.AST:
    """Docstrings are about a quarter of the bytecode and nothing at runtime
    reads them (unlike -OO this keeps `assert` and `__debug__`)."""
    for node in ast.walk(tree):
        if isinstance(node, _SCOPES) and node.body \
                and isinstance(node.body[0], ast.Expr) \
                and isinstance(node.body[0].value, ast.Constant) \
                and isinstance(node.body[0].value.value, str):
            doc = node.body[0]
            node.body = node.body[1:] or [ast.copy_location(ast.Pass(), doc)]
    return tree


def pyc_bytes(source: bytes, dfile: str) -> bytes:
    tree = _drop_docstrings(ast.parse(source, dfile))
    code = compile(tree, dfile, "exec", dont_inherit=True, optimize=0)
    return _code_to_hash_pyc(code, importlib.util.source_hash(source),
                             checked=False)


def _write(zf: zipfile.ZipFile, name: str, data: bytes) -> None:
    info = zipfile.ZipInfo(name, EPOCH)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    zf.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9)


def _entries(items, dfile_root, compile_py):
    for name, data in sorted(items):
        if name.endswith("/") or "__pycache__/" in name:
            continue
        if compile_py and name.endswith(".pyi"):
            continue                      # type stubs: no use at runtime
        if compile_py and name.endswith(".py"):
            yield name + "c", pyc_bytes(data, dfile_root + name)
        else:
            yield name, data


def pack(src_dir, dst_zip, dfile_root="", compile_py=False):
    src = Path(src_dir)
    items = [(p.relative_to(src).as_posix(), p.read_bytes())
             for p in src.rglob("*") if p.is_file()]
    with zipfile.ZipFile(dst_zip, "w") as zf:
        for name, data in _entries(items, dfile_root, compile_py):
            _write(zf, name, data)


def repack_wheel(src, dst, dfile_root):
    with zipfile.ZipFile(src) as zin:
        items = [(i.filename, zin.read(i)) for i in zin.infolist()]
    with zipfile.ZipFile(dst, "w") as zf:
        for name, data in _entries(items, dfile_root, True):
            _write(zf, name, data)
