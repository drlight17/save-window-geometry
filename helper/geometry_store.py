#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

SERVICE_NAME = "org.kde.savewindowgeometry"
OBJECT_PATH = "/SaveWindowGeometry"
INTERFACE = "org.kde.SaveWindowGeometry"
CONFIG_GROUP = "Script-save-window-geometry"
CONFIG_KEY = "state"
MAX_PAYLOAD = 1024 * 1024
MAX_LOG_SIZE = 128 * 1024

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(BASE_DIR, "geometry.json")
LOG_FILE = os.path.join(BASE_DIR, "helper.log")


def log(message):
    try:
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > MAX_LOG_SIZE:
            os.replace(LOG_FILE, LOG_FILE + ".old")
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(time.strftime("%Y-%m-%d %H:%M:%S ") + message + "\n")
    except OSError:
        pass


def number(value):
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return value
    return 0


def read_state_data():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as handle:
            raw = handle.read(MAX_PAYLOAD + 1)
    except OSError:
        return None
    if len(raw) > MAX_PAYLOAD:
        log("state file is too large, ignoring")
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        log("state file is not valid JSON, ignoring")
        return None
    if not isinstance(data, dict) or not isinstance(data.get("windows"), dict):
        log("state file has an unexpected structure, ignoring")
        return None
    return data


def merge_state(existing, incoming):
    merged = {}
    existing_windows = existing.get("windows") if isinstance(existing, dict) else None
    incoming_windows = incoming.get("windows") if isinstance(incoming, dict) else None
    if isinstance(existing_windows, dict):
        for key, entry in existing_windows.items():
            if isinstance(key, str) and isinstance(entry, dict):
                merged[key] = entry
    if isinstance(incoming_windows, dict):
        for key, entry in incoming_windows.items():
            if not isinstance(key, str) or not isinstance(entry, dict):
                continue
            current = merged.get(key)
            if current is None:
                merged[key] = entry
                continue
            current_updated = number(current.get("updated"))
            new_updated = number(entry.get("updated"))
            if new_updated > current_updated or (new_updated == current_updated and new_updated != 0):
                merged[key] = entry
    existing_saved_at = existing.get("savedAt") if isinstance(existing, dict) else 0
    incoming_saved_at = incoming.get("savedAt") if isinstance(incoming, dict) else 0
    saved_at = max(number(existing_saved_at), number(incoming_saved_at), int(time.time() * 1000))
    return {
        "version": 1,
        "savedAt": int(saved_at),
        "windows": merged,
    }


def write_state(data):
    os.makedirs(BASE_DIR, exist_ok=True)
    text = json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    fd, tmp_path = tempfile.mkstemp(prefix=".geometry-", suffix=".json", dir=BASE_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp_path, 0o600)
        os.replace(tmp_path, STATE_FILE)
        return True
    except OSError as error:
        log("could not write state: %s" % error)
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return False


def compact(data):
    return json.dumps(data, separators=(",", ":"), sort_keys=True, ensure_ascii=False)


def read_kwin_value():
    tool = shutil.which("kreadconfig5")
    if not tool:
        return None
    try:
        result = subprocess.run(
            [tool, "--file", "kwinrc", "--group", CONFIG_GROUP, "--key", CONFIG_KEY],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.rstrip("\n")


def write_kwin_value(value):
    tool = shutil.which("kwriteconfig5")
    if not tool:
        return False
    try:
        result = subprocess.run(
            [tool, "--file", "kwinrc", "--group", CONFIG_GROUP, "--key", CONFIG_KEY, value],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def reconfigure_kwin():
    tool = shutil.which("qdbus")
    if not tool:
        return
    try:
        subprocess.run(
            [tool, "org.kde.KWin", "/KWin", "reconfigure"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        pass


def sync_to_kwin():
    data = read_state_data()
    if data is None:
        return False
    payload = compact(data)
    if read_kwin_value() == payload:
        return False
    if not write_kwin_value(payload):
        return False
    reconfigure_kwin()
    log("synced %d entries into kwinrc" % len(data["windows"]))
    return True


class GeometryStore(dbus.service.Object):
    def __init__(self, bus, loop):
        super().__init__(bus, OBJECT_PATH)
        self._loop = loop

    @dbus.service.method(INTERFACE, in_signature="s", out_signature="b")
    def Store(self, payload):
        try:
            if not isinstance(payload, str) or not payload or len(payload) > MAX_PAYLOAD:
                return False
            try:
                incoming = json.loads(payload)
            except ValueError:
                log("rejected invalid JSON payload")
                return False
            if not isinstance(incoming, dict) or not isinstance(incoming.get("windows"), dict):
                log("rejected payload without a windows map")
                return False
            existing = read_state_data()
            return write_state(merge_state(existing, incoming))
        except Exception as error:
            log("Store failed: %s" % error)
            return False

    @dbus.service.method(INTERFACE, in_signature="", out_signature="b")
    def Sync(self):
        try:
            return sync_to_kwin()
        except Exception as error:
            log("Sync failed: %s" % error)
            return False

    @dbus.service.method(INTERFACE, in_signature="", out_signature="")
    def Quit(self):
        log("quit requested")
        self._loop.quit()


def main():
    log("starting")
    DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    loop = GLib.MainLoop()
    try:
        name = dbus.service.BusName(SERVICE_NAME, bus=bus)
    except dbus.exceptions.NameExistsException:
        log("another instance is already running")
        return 0
    store = GeometryStore(bus, loop)
    loop.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
