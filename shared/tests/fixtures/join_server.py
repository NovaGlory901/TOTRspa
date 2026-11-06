"""Starts the real TOTR server (SQLite, one admin account, joining switched on) on a local port, for tests/joinclient.test.cjs. Usage: join_server.py <port> <state-dir>
Prints "ready" when it answers. Stops when its input closes."""
import os
import pathlib
import sys
import threading

port, state = int(sys.argv[1]), pathlib.Path(sys.argv[2])
root = pathlib.Path(__file__).resolve().parents[4] / "TOTRsrv"
os.chdir(root)
sys.path.insert(0, str(root))
os.environ.update(DB_ENGINE="sqlite", TOTR_DATA_DIR=str(state / "data"), APP_SETTINGS=str(state / "app_settings.json"), COLLECTOR_DIR=str(state / "reports"),
                  MAINT_REPORT=str(state / "reports" / "m.json"), HOST=os.environ.get("JOIN_HOST", "127.0.0.1"), PORT=str(port), TOTR_STATE_DIR=str(state))
for k in ("DB_AUTH_USER", "DB_AUTH_PASSWORD", "TLS_CERT", "TLS_KEY"):
    os.environ.pop(k, None)
import app_settings
app_settings.set_join_open(True)
from auth import service
service.create_user("boss", "correct horse battery staple", "admin")
import uvicorn
import main
server = uvicorn.Server(uvicorn.Config(main.app, host=os.environ.get("JOIN_HOST", "127.0.0.1"), port=port, log_level="warning"))
threading.Thread(target=lambda: (sys.stdin.read(), setattr(server, "should_exit", True)), daemon=True).start()
orig = server.startup
async def startup(*a, **k):
    await orig(*a, **k)
    print("ready", flush=True)
server.startup = startup
server.run()
