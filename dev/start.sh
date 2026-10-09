#!/usr/bin/env bash
# Start a local Synapse homeserver on localhost:8008.
#
#   bash dev/start.sh          create the venv, secrets and config on first run, then run Synapse
#   bash dev/start.sh reset    delete local state (data/, .secrets, gatekeeper db)
set -euo pipefail

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$DEV_DIR/data"
SECRETS="$DEV_DIR/.secrets"
VENV="$DEV_DIR/.venv"

if [ "${1:-}" = "reset" ]; then
  rm -rf "$DATA_DIR" "$SECRETS" "$DEV_DIR/../gatekeeper/data"
  echo "Removed dev/data, dev/.secrets and the gatekeeper database."
  exit 0
fi

random_hex() { python3.12 -c 'import secrets; print(secrets.token_hex(32))'; }

if [ ! -x "$VENV/bin/python" ]; then
  echo "Creating Python 3.12 virtualenv..."
  python3.12 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet --upgrade pip
  "$VENV/bin/pip" install --quiet -r "$DEV_DIR/requirements.txt"
fi

if [ ! -f "$SECRETS" ]; then
  echo "Generating development secrets..."
  (
    umask 077
    {
      echo "REGISTRATION_SHARED_SECRET=$(random_hex)"
      echo "GATEKEEPER_ADMIN_TOKEN=$(random_hex)"
      echo "MACAROON_SECRET_KEY=$(random_hex)"
      echo "FORM_SECRET=$(random_hex)"
    } > "$SECRETS"
  )
fi

mkdir -p "$DATA_DIR"
# shellcheck disable=SC1090
set -a; . "$SECRETS"; set +a

sed \
  -e "s|@@DATA_DIR@@|$DATA_DIR|g" \
  -e "s|@@DEV_DIR@@|$DEV_DIR|g" \
  -e "s|@@REGISTRATION_SHARED_SECRET@@|$REGISTRATION_SHARED_SECRET|g" \
  -e "s|@@MACAROON_SECRET_KEY@@|$MACAROON_SECRET_KEY|g" \
  -e "s|@@FORM_SECRET@@|$FORM_SECRET|g" \
  "$DEV_DIR/homeserver.yaml.template" > "$DATA_DIR/homeserver.yaml"
chmod 600 "$DATA_DIR/homeserver.yaml"

if [ ! -f "$DATA_DIR/signing.key" ]; then
  "$VENV/bin/python" -m synapse.app.homeserver -c "$DATA_DIR/homeserver.yaml" --generate-keys
fi

echo "Synapse listening on http://localhost:8008 (Ctrl-C to stop)"
exec "$VENV/bin/python" -m synapse.app.homeserver -c "$DATA_DIR/homeserver.yaml"
