# Save Window Geometry (KWin script)

A small KWin script for Plasma 5 (developed and verified against Plasma 5.27 /
KWin 5.27.11) that remembers the size and position of normal application
windows and restores them when a window with the same application identity is
opened again.

The geometry is stored in a JSON file, so it survives KWin restarts, logging
out, shutdown and reboot. Dialogs, popups, menus, toolbars, docks, splash
screens, utility windows, fullscreen windows and other special windows are
ignored.

## Behavior

- Every regular window is identified by `resourceClass`, `resourceName` and
  `windowRole` (falling back to `desktopFileName`).
- The latest geometry is recorded while the window is used. It is persisted
  when the window is moved/resized (throttled), when an interactive move/resize
  finishes, and when a window is closed.
- When a new window with the same identity appears, the recorded geometry is
  applied. If the window was maximized when it was closed, its normal geometry
  and the screen it was maximized on are restored, then the window is
  maximized on that screen again.
- If the remembered position is no longer on any connected screen (for
  example after unplugging a monitor), the window is centered on the screen
  where it would have opened.

## Ignoring applications

Open *System Settings -> Window Management -> KWin Scripts*, select **Save
Window Geometry** and click **Configure**. The page contains a blacklist of
window classes / application ids; matching is case-insensitive against the
window class, application name, desktop file and window role. Matching windows
are ignored by this script entirely (KWin still manages them normally).

Plasma 5 script settings pages are static declarative forms and cannot run a
D-Bus window picker. The picker is therefore integrated into the window menu
and a global shortcut:

- Right-click a window title bar, open **More Actions** and choose **Ignore for
  Save Window Geometry**.
- Or focus the window and press **Meta+Shift+I** (the default; change it in
  *System Settings -> Shortcuts*).

Either action reads the window's class/application id and adds it to the
blacklist. A notification confirms the entry. The helper writes the list to the
`Blacklist` key of `[Script-save-window-geometry]` in `kwinrc` and asks KWin to
reload, so the settings page and the running script see the change; the helper
also watches `kwinrc` so edits made through the settings page are applied
without a restart.

## Persistence

KWin scripts in Plasma 5 cannot write files, so the package includes a small
D-Bus-activated helper. The script sends the state to the helper, which:

- writes `~/.local/share/save-window-geometry/geometry.json` (or the
  `XDG_DATA_HOME` equivalent);
- mirrors the state into the script's own `kwinrc` group when KWin starts
  (`Script-save-window-geometry`), because `readConfig()` is the only way a
  Plasma 5 KWin script can read persisted data.

At startup the script reads the mirror, asks the helper to push the latest JSON
into `kwinrc`, and merges the result via `options.configChanged`. Records are
merged by an `updated` timestamp, so running windows are not overwritten by
older data.

The JSON file looks like this:

```json
{
  "version": 1,
  "savedAt": 1700000000000,
  "windows": {
    "dolphin|dolphin|mainwindow": {
      "x": 120,
      "y": 80,
      "width": 900,
      "height": 650,
      "maximized": false,
      "updated": 1700000000000
    }
  }
}
```

Maximized records additionally include `maxScreen` and `maxArea`, so a window
that was maximized on a secondary monitor is restored maximized on that monitor
rather than on the screen where its normal geometry used to be.

The helper needs `python3-dbus` and `python3-gi`. It logs to
`~/.local/share/save-window-geometry/helper.log`.

## Install

```sh
./install.sh
```

The installer also adds the custom `save-window-geometry` icon to the user icon
theme, so the KWin Scripts page shows it next to the script. Reopen System
Settings if that page was already open.

Then enable **Save Window Geometry** in
*System Settings -> Window Management -> KWin Scripts*, or from a shell:

```sh
kwriteconfig5 --file kwinrc --group Plugins --key save-window-geometryEnabled true
qdbus org.kde.KWin /KWin reconfigure
```

## Uninstall

```sh
./uninstall.sh
```

This unloads the script from the running KWin, removes its enabled flag and
persisted-state mirror from `kwinrc`, asks KWin to reload its scripts, stops
the helper, and deletes the installed script, helper and JSON state. Use
`--keep-state` to preserve `geometry.json`, or `--dry-run` to see what would
happen without changing anything.

Manual equivalent:

```sh
kwriteconfig5 --file kwinrc --group Plugins --key save-window-geometryEnabled --delete
kwriteconfig5 --file kwinrc --group Script-save-window-geometry --key state --delete
qdbus org.kde.KWin /KWin reconfigure
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/kwin/scripts/save-window-geometry"
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/save-window-geometry"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/dbus-1/services/org.kde.savewindowgeometry.service"
```

## Limitations

- The script restores geometry when a window is created; it does not start
  applications. Applications that are reopened by Plasma's session restore or
  by autostart get their geometry restored when their windows appear.
- One geometry is stored per application identity. When several windows of the
  same application are open at once and all are closed, reopening them uses
  the most recently updated geometry for each of them.
- Maximized state is detected from the window geometry relative to the
  maximization area. Partial (edge/corner) maximization is restored as a plain
  geometry, not as a maximized state. Full maximization is restored on the
  saved monitor.
- If the helper's `kwinrc` sync happens after an application window has already
  appeared, that window can use a slightly older record; the next window of
  the same application gets the latest state.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
