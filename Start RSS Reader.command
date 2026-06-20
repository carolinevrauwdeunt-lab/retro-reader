#!/bin/bash
cd "$(dirname "$0")"

# Kill any previous instance
lsof -ti:3334 | xargs kill -9 2>/dev/null

# Start the server
node server.js &

# Wait for it to be ready
sleep 1

# Open the reader in the browser
open http://localhost:3334
