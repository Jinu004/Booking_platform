#!/bin/bash
set -e
DB_NAME="bookingplatform"
DB_USER="receptionai"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "=== ReceptionAI Server Setup ==="
echo "1. Applying baseline schema..."
cp "$REPO_DIR/infrastructure/baseline.sql" /tmp/receptionai_baseline.sql
chmod 644 /tmp/receptionai_baseline.sql
sudo -u postgres psql -d "$DB_NAME" -f /tmp/receptionai_baseline.sql
rm /tmp/receptionai_baseline.sql
echo "2. Running incremental migrations..."
for f in $(ls "$REPO_DIR/backend/src/database/migrations/"*.sql | sort); do
  echo "   Running: $(basename $f)"
  cp "$f" /tmp/receptionai_migration.sql
  chmod 644 /tmp/receptionai_migration.sql
  sudo -u postgres psql -d "$DB_NAME" -f /tmp/receptionai_migration.sql 2>&1 | grep -v "already exists" || true
  rm /tmp/receptionai_migration.sql
done
echo "3. Granting DB permissions..."
sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER; GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;"
echo "4. Setting default privileges for future tables..."
sudo -u postgres psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;"
echo "=== Setup complete ==="
