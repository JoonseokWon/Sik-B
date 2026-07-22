from __future__ import annotations

import argparse
import json
import mimetypes
import os
import socket
import tempfile
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "local-data"
STATE_FILE = DATA_DIR / "food-fee-state.json"
STATE_LOCK = threading.Lock()
MAX_BODY_BYTES = 5 * 1024 * 1024


def load_store() -> Dict[str, dict]:
    if not STATE_FILE.exists():
        return {}
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def save_store(store: Dict[str, dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix="food-fee-", suffix=".json", dir=DATA_DIR)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as temporary_file:
            json.dump(store, temporary_file, ensure_ascii=False, indent=2)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_name, STATE_FILE)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


class FoodFeeHandler(SimpleHTTPRequestHandler):
    server_version = "SikBFoodFee/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def state_group(self) -> Optional[str]:
        path = unquote(urlparse(self.path).path)
        prefix = "/api/state/"
        if not path.startswith(prefix):
            return None
        group = path[len(prefix):].strip()
        return group if group and "/" not in group and "\\" not in group else None

    def do_GET(self) -> None:
        path = unquote(urlparse(self.path).path)
        if path == "/api/health":
            self.send_json(HTTPStatus.OK, {"ok": True, "storage": str(STATE_FILE.relative_to(ROOT))})
            return
        group = self.state_group()
        if group is not None:
            with STATE_LOCK:
                state = load_store().get(group)
            if state is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "저장된 그룹 데이터가 없습니다."})
            else:
                self.send_json(HTTPStatus.OK, state)
            return
        if path == "/local-data" or path.startswith("/local-data/") or path == "/.git" or path.startswith("/.git/"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        super().do_GET()

    def do_PUT(self) -> None:
        group = self.state_group()
        if group is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "지원하지 않는 경로입니다."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "저장 데이터 크기가 올바르지 않습니다."})
            return
        try:
            state = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "JSON 형식을 확인해 주세요."})
            return
        if not isinstance(state, dict) or state.get("groupName") != group:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "그룹명이 요청 경로와 일치하지 않습니다."})
            return
        with STATE_LOCK:
            store = load_store()
            store[group] = state
            save_store(store)
        self.send_json(HTTPStatus.OK, {"ok": True, "groupName": group})

    def do_DELETE(self) -> None:
        group = self.state_group()
        if group is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "지원하지 않는 경로입니다."})
            return
        with STATE_LOCK:
            store = load_store()
            store.pop(group, None)
            save_store(store)
        self.send_json(HTTPStatus.OK, {"ok": True, "groupName": group})

    def log_message(self, format_string: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {format_string % args}")


def local_addresses(port: int) -> List[str]:
    addresses = [f"http://127.0.0.1:{port}/"]
    try:
        host_name = socket.gethostname()
        for address in socket.gethostbyname_ex(host_name)[2]:
            if not address.startswith("127."):
                addresses.append(f"http://{address}:{port}/")
    except OSError:
        pass
    return list(dict.fromkeys(addresses))


def main() -> None:
    parser = argparse.ArgumentParser(description="Sik-B Food-Fee local shared server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    mimetypes.add_type("application/javascript", ".js")
    server = ThreadingHTTPServer((args.host, args.port), FoodFeeHandler)
    print("Sik-B Food-Fee 공용 저장 서버가 실행 중입니다.")
    for address in local_addresses(args.port):
        print(address)
    print("이 창을 닫으면 서버가 종료됩니다. 브라우저는 자동으로 열리지 않습니다.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
