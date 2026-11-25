#!/usr/bin/env bash
set -euo pipefail

plugin_id="save-window-geometry"
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
target_dir="${data_home}/kwin/scripts/${plugin_id}"
helper_dir="${data_home}/${plugin_id}"
helper_path="${helper_dir}/geometry_store.py"
service_dir="${data_home}/dbus-1/services"
service_file="${service_dir}/org.kde.savewindowgeometry.service"
icon_dir="${data_home}/icons/hicolor/scalable/apps"
icon_file="${icon_dir}/${plugin_id}.svg"

install -d -- "$target_dir" "$helper_dir" "$service_dir" "$icon_dir"

rm -rf -- "$target_dir/contents" "$target_dir/metadata.json"
install -m 0644 -- "$source_dir/metadata.json" "$target_dir/metadata.json"
cp -r -- "$source_dir/contents" "$target_dir/contents"
install -m 0755 -- "$source_dir/helper/geometry_store.py" "$helper_path"
install -m 0644 -- "$source_dir/icon/${plugin_id}.svg" "$icon_file"

cat > "$service_file" <<EOF
[D-BUS Service]
Name=org.kde.savewindowgeometry
Exec=${helper_path}
EOF
chmod 0644 -- "$service_file"

persistence="enabled"
if ! command -v python3 >/dev/null 2>&1 || ! python3 -c "import dbus, dbus.service; from dbus.mainloop.glib import DBusGMainLoop; from gi.repository import GLib" >/dev/null 2>&1; then
    persistence="unavailable (python3-dbus and python3-gi are required)"
fi

echo "Installed ${plugin_id}:"
echo "  script:  ${target_dir}"
echo "  helper:  ${helper_path}"
echo "  service: ${service_file}"
echo "  icon:    ${icon_file}"
echo "  state:   ${helper_dir}/geometry.json"
echo "  persistence: ${persistence}"
echo
echo "Activate it in System Settings -> Window Management -> KWin Scripts,"
echo "or from a shell:"
echo "  kwriteconfig5 --file kwinrc --group Plugins --key ${plugin_id}Enabled true"
echo "  qdbus org.kde.KWin /KWin reconfigure"
echo
echo "To remove it later, run: ${source_dir}/uninstall.sh"
