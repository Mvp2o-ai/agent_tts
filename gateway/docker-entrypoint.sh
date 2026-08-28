#!/bin/sh
# Start as root only long enough to own host-mounted volumes, then drop
# to the non-root `agent` user. Railway, Compose, and many k8s volume
# plugins mount persistent disks as root; the gateway must not stay root.
set -eu

data_dir="${AGENT_TTS_DATA_DIR:-/data}"
workspace_dir="${WORKSPACE_DIR:-/workspace}"

if [ "$(id -u)" = "0" ]; then
  if [ -d "$data_dir" ]; then
    agent_uid="$(id -u agent)"
    owner="$(stat -c '%u' "$data_dir" 2>/dev/null || echo 0)"
    if [ "$owner" != "$agent_uid" ]; then
      chown -R agent:agent "$data_dir"
    fi
  fi
  if [ -d "$workspace_dir" ]; then
    chown agent:agent "$workspace_dir"
  fi
  exec gosu agent:agent "$@"
fi

exec "$@"
