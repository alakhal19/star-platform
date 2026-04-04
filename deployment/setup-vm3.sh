#!/bin/bash
# ═══════════════════════════════════════════════════════════
# STAR VM3 Setup Script
# Run this on VM3 (Ubuntu) as root or with sudo
# ═══════════════════════════════════════════════════════════

set -e

echo "╔══════════════════════════════════════════════╗"
echo "║   STAR VM3 Setup                             ║"
echo "╚══════════════════════════════════════════════╝"

# ─── 1. Create star system user ────────────────────────
echo "[1/8] Creating star system user..."
if id "star" &>/dev/null; then
  echo "  User 'star' already exists"
else
  useradd --system --shell /bin/false --home /opt/star --create-home star
  echo "  User 'star' created"
fi

# ─── 2. Create directory structure ─────────────────────
echo "[2/8] Creating directory structure..."
mkdir -p /opt/star/backend
mkdir -p /var/log/star
mkdir -p /var/run/star
mkdir -p /var/lib/star/db
mkdir -p /var/lib/star/queue

chown -R star:star /opt/star
chown -R star:star /var/log/star
chown -R star:star /var/run/star
chown -R star:star /var/lib/star
echo "  Directories created"

# ─── 3. Install Node.js 20 LTS ────────────────────────
echo "[3/8] Installing Node.js 20 LTS..."
if command -v node &>/dev/null; then
  echo "  Node.js already installed: $(node --version)"
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo "  Node.js installed: $(node --version)"
fi

# ─── 4. Install PostgreSQL ─────────────────────────────
echo "[4/8] Installing PostgreSQL..."
if command -v psql &>/dev/null; then
  echo "  PostgreSQL already installed: $(psql --version)"
else
  apt-get install -y postgresql postgresql-contrib
  systemctl enable postgresql
  systemctl start postgresql
  echo "  PostgreSQL installed"
fi

# ─── 5. Install Redis ─────────────────────────────────
echo "[5/8] Installing Redis..."
if command -v redis-server &>/dev/null; then
  echo "  Redis already installed: $(redis-server --version)"
else
  apt-get install -y redis-server
  systemctl enable redis-server
  systemctl start redis-server
  echo "  Redis installed"
fi

# ─── 6. Install Apache HTTPD ──────────────────────────
echo "[6/8] Installing Apache HTTPD..."
if command -v apache2 &>/dev/null; then
  echo "  Apache already installed: $(apache2 -v | head -1)"
else
  apt-get install -y apache2
  a2enmod proxy proxy_http proxy_balancer lbmethod_byrequests headers rewrite
  systemctl enable apache2
  echo "  Apache installed with proxy modules enabled"
fi

# ─── 7. Create PostgreSQL database ────────────────────
echo "[7/8] Creating star_db database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'star_db'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE star_db;"
echo "  Database star_db ready"

# ─── 8. Install systemd service ───────────────────────
echo "[8/8] Installing systemd service..."
cp /opt/star/deployment/star.service /etc/systemd/system/star.service
systemctl daemon-reload
systemctl enable star
echo "  Service installed and enabled"

echo ""
echo "═══════════════════════════════════════════════"
echo "  VM3 setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Copy STAR backend to /opt/star/backend/"
echo "    2. cd /opt/star/backend && npm install --production"
echo "    3. npx prisma migrate deploy"
echo "    4. npx prisma generate"
echo "    5. npm run seed"
echo "    6. Edit /opt/star/backend/.env with real values"
echo "    7. sudo systemctl start star"
echo "    8. sudo systemctl status star"
echo "═══════════════════════════════════════════════"
