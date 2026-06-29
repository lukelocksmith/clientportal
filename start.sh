#!/bin/sh
set -e

echo "Running database migrations..."
node migrate.js

echo "Starting server..."
exec node server.js
