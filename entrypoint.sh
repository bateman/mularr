#!/bin/sh
set -e

# Optional UMASK (e.g. 002 -> files 664, dirs 775). Applied before creating any
# directory and inherited by node and by the amuled process it spawns.
if [ -n "$UMASK" ]; then
    umask "$UMASK" || { echo "Invalid UMASK value: '$UMASK' (expected an octal mask like 002 or 022)"; exit 1; }
    echo "Using umask $(umask)"
fi

# Define generic password hash for 'secret' if not provided?
# For simplicity we hardcode the hash for 'secret' to match defaults.
# MD5("secret") = 5ebe2294ecd0e0f08eab7690d2a6ee69

CONF_DIR="${AMULE_CONFIG_DIR:-$HOME/.aMule}"
INCOMING_DIR="${AMULE_INCOMING_DIR:-$CONF_DIR/Incoming}"
TEMP_DIR="${AMULE_TEMP_DIR:-$CONF_DIR/Temp}"

mkdir -p "$CONF_DIR"
mkdir -p "$INCOMING_DIR"
mkdir -p "$TEMP_DIR"

if [ ! -f "$CONF_DIR/amule.conf" ]; then
    echo "Generating amule.conf..."
    cat <<EOF > "$CONF_DIR/amule.conf"
[eMule]
Nick=Mularr
IncomingDir=$INCOMING_DIR
TempDir=$TEMP_DIR

[ExternalConnect]
AcceptExternalConnections=1
ECAddress=127.0.0.1
ECPort=4712
ECPassword=5ebe2294ecd0e0f08eab7690d2a6ee69
EOF
else
    # Update directories if env vars are provided and file exists
    if [ -n "$AMULE_INCOMING_DIR" ]; then
        sed -i "s|^IncomingDir=.*|IncomingDir=$AMULE_INCOMING_DIR|" "$CONF_DIR/amule.conf"
    fi
    if [ -n "$AMULE_TEMP_DIR" ]; then
        sed -i "s|^TempDir=.*|TempDir=$AMULE_TEMP_DIR|" "$CONF_DIR/amule.conf"
    fi
fi

echo "Starting Mularr backend..."
exec "$@"
