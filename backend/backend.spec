# PyInstaller build of the data service (one folder, no Python needed on the target PC).
#   cd backend
#   .venv\Scripts\pyinstaller.exe backend.spec --noconfirm --clean
# Output: backend\dist\fvt-backend\fvt-backend.exe  (copied into the installer by electron-builder)

from PyInstaller.utils.hooks import collect_submodules

hidden = (
    collect_submodules("uvicorn")
    + collect_submodules("app")
    + ["argon2", "argon2.low_level", "_cffi_backend", "sqlalchemy.dialects.sqlite", "openpyxl.cell._writer"]
)

a = Analysis(
    ["run.py"],
    pathex=["."],
    datas=[("migrations", "migrations"), ("alembic.ini", ".")],
    hiddenimports=hidden,
    excludes=["tkinter", "pytest", "IPython", "matplotlib"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="fvt-backend",
    console=True,  # Electron reads its stdout; it is started hidden (windowsHide), so no window appears
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="fvt-backend", upx=False)
