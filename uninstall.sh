#!/usr/bin/env bash
set -euo pipefail

plugin_id="save-window-geometry"
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
target_dir="${data_home}/kwin/scripts/${plugin_id}"
helper_dir="${data_home}/${plugin_id}"
helper_path="${helper_dir}/geometry_store.py"
service_file="${data_home}/dbus-1/services/org.kde.savewindowgeometry.service"
icon_file="${data_home}/icons/hicolor/scalable/apps/${plugin_id}.svg"
dry_run=false
keep_state=false

for arg in "$@"; do
    case "$arg" in
        -n|--dry-run)
            dry_run=true
            ;;
        --keep-state)
            keep_state=true
            ;;
        -h|--help)
            echo "Usage: $0 [--dry-run] [--keep-state]"
            echo
            echo "Disables the ${plugin_id} KWin script, removes its installed files"
            echo "and its saved geometry state. --keep-state preserves the JSON file."
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            echo "Usage: $0 [--dry-run] [--keep-state]" >&2
            exit 2
            ;;
    esac
done

run_quiet() {
    if [ "$dry_run" = true ]; then
        printf 'would run: %s\n' "$*"
    else
        "$@" >/dev/null 2>&1 || true
    fi
}

remove_path() {
    local path="$1"
    if [ -e "$path" ]; then
        if [ "$dry_run" = true ]; then
            printf 'would remove: %s\n' "$path"
        else
            rm -rf -- "$path"
            echo "Removed ${path}"
        fi
    else
        echo "Nothing to remove at ${path}"
    fi
}

remove_file() {
    local path="$1"
    if [ -f "$path" ]; then
        if [ "$dry_run" = true ]; then
            printf 'would remove: %s\n' "$path"
        else
            rm -f -- "$path"
            echo "Removed ${path}"
        fi
    fi
}

if command -v qdbus >/dev/null 2>&1; then
    run_quiet qdbus org.kde.savewindowgeometry /SaveWindowGeometry org.kde.SaveWindowGeometry.Quit
fi

if command -v kwriteconfig5 >/dev/null 2>&1; then
    run_quiet kwriteconfig5 --file kwinrc --group Plugins --key "${plugin_id}Enabled" --delete
    run_quiet kwriteconfig5 --file kwinrc --group Script-${plugin_id} --key state --delete
fi

if command -v qdbus >/dev/null 2>&1; then
    run_quiet qdbus org.kde.KWin /KWin reconfigure
fi

remove_path "$target_dir"
remove_file "$service_file"
remove_file "$icon_file"

if [ "$keep_state" = true ]; then
    remove_file "$helper_path"
    remove_file "${helper_dir}/helper.log"
    remove_file "${helper_dir}/helper.log.old"
    if [ -f "${helper_dir}/geometry.json" ]; then
        echo "Kept saved state: ${helper_dir}/geometry.json"
    fi
else
    remove_path "$helper_dir"
fi

if [ "$dry_run" = true ]; then
    echo "Dry run: ${plugin_id} was not uninstalled."
else
    echo "Uninstalled ${plugin_id}."
fi
