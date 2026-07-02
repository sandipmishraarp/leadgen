#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-leadgen}"
NODE_VERSION="${NODE_VERSION:-24}"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$DEPLOY_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed on this Ubuntu server."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed on this Ubuntu server."
  exit 1
fi

echo "Using Node $(node -v) and npm $(npm -v)"

required_files=(
  "package.json"
  "tsconfig.json"
  ".next/BUILD_ID"
  "src/components/AppShell.tsx"
)

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "Missing required file: $file"
    exit 1
  fi
done

if [ ! -f .env ] && [ -f .env.production ]; then
  cp .env.production .env
fi

if [ ! -f .env ]; then
  echo "Missing .env in $DEPLOY_DIR. Create it on the server before deploying."
  exit 1
fi

export NODE_ENV=production

echo "Installing dependencies..."
npm install -g npm@10.9.2
npm ci

echo "Generating Prisma client..."
npx prisma generate

echo "Applying database migrations..."
npx prisma migrate deploy

if [ ! -d .next ]; then
  echo "Missing .next build output. Build should run in GitHub Actions before deploy."
  exit 1
fi

echo "Using prebuilt Next.js output from CI (.next/BUILD_ID=$(cat .next/BUILD_ID))"

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
  echo "PM2 is not installed. On Ubuntu run: npm install -g pm2 && pm2 startup"
  exit 1
fi

echo "Deployment completed successfully."
