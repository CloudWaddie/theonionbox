#!/bin/sh
# Starts The Onion Box in the container.
#   TOB_DATA_DIR        where cc.cfg & the monitoring database live (default /data; mount a volume here!)
#   TOB_CONTROLCENTER   set to 0 to run the single node dashboard instead of the ControlCenter
#   TOB_ACCESS_PASSWORD protects the whole Box with a password (strongly recommended)
set -e

DATA="${TOB_DATA_DIR:-/data}"
mkdir -p "$DATA"

if [ "${TOB_CONTROLCENTER:-1}" = "0" ]; then
    exec theonionbox -c /etc/theonionbox/theonionbox.cfg "$@"
fi

# The ControlCenter needs its (writable) configuration file to exist.
[ -f "$DATA/cc.cfg" ] || : > "$DATA/cc.cfg"
exec theonionbox -c /etc/theonionbox/theonionbox.cfg -x "$DATA/cc.cfg" "$@"
