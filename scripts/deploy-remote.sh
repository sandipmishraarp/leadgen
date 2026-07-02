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

APP_PORT="3001"
if grep -q '^PORT=' .env; then
  sed -i 's/^PORT=.*/PORT=3001/' .env
else
  echo "PORT=3001" >> .env
fi

export PORT="$APP_PORT"

free_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti:"${port}" | xargs -r kill -9 2>/dev/null || true
  fi
  sleep 1
}

if command -v pm2 >/dev/null 2>&1; then
  echo "Stopping existing PM2 process: $APP_NAME"
  pm2 stop "$APP_NAME" 2>/dev/null || true
  pm2 delete "$APP_NAME" 2>/dev/null || true

  echo "Freeing port ${APP_PORT}..."
  free_port "$APP_PORT"

  echo "Starting PM2 process: $APP_NAME on port ${APP_PORT}"
  pm2 start npm --name "$APP_NAME" --update-env -- start
  pm2 save
else
  echo "PM2 is not installed. On Ubuntu run: npm install -g pm2 && pm2 startup"
  exit 1
fi

echo "Deployment completed successfully."
