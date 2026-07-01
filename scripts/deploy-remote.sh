#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-leadgen}"
NODE_VERSION="${NODE_VERSION:-24}"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$DEPLOY_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed on the server."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed on the server."
  exit 1
fi

if [ ! -f .env ] && [ -f .env.production ]; then
  cp .env.production .env
fi

if [ ! -f .env ]; then
  echo "Missing .env in $DEPLOY_DIR. Create it on the server before deploying."
  exit 1
fi

export NODE_ENV=production

echo "Installing dependencies..."
npm ci

echo "Generating Prisma client..."
npx prisma generate

echo "Applying database migrations..."
npx prisma migrate deploy

echo "Building Next.js application..."
npm run build

if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    echo "Restarting PM2 process: $APP_NAME"
    pm2 restart "$APP_NAME" --update-env
  else
    echo "Starting PM2 process: $APP_NAME"
    pm2 start npm --name "$APP_NAME" -- start
    pm2 save
  fi
else
  echo "PM2 is not installed. Install it with: npm install -g pm2"
  echo "Starting app in the foreground is not supported in CI deploy."
  exit 1
fi

echo "Deployment completed successfully."
