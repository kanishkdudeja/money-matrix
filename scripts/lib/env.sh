#!/usr/bin/env bash

load_project_env() {
  local project_root
  project_root="$(git rev-parse --show-toplevel)"

  if [ ! -f "$project_root/.env" ]; then
    echo "Missing $project_root/.env; run 'mise run bootstrap' first." >&2
    return 1
  fi

  set -a
  # shellcheck disable=SC1091
  . "$project_root/.env"
  set +a
}
