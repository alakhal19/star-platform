#!/bin/bash
# ═══════════════════════════════════════════════════════════
# STAR Apache HTTPD Setup
# Run this on VM3 after setup-vm3.sh
# ═══════════════════════════════════════════════════════════

set -e

echo "Setting up Apache for STAR..."

# Enable required modules
echo "[1/4] Enabling Apache modules..."
a2enmod proxy proxy_http proxy_balancer lbmethod_byrequests headers rewrite
echo "  Modules enabled"

# Copy config
echo "[2/4] Installing STAR virtual host..."
cp /opt/star/deployment/star-apache.conf /etc/apache2/sites-available/star.conf

# Disable default site, enable STAR
echo "[3/4] Enabling STAR site..."
a2dissite 000-default.conf 2>/dev/null || true
a2ensite star.conf

# Test and restart
echo "[4/4] Testing and restarting Apache..."
apache2ctl configtest
systemctl restart apache2

echo ""
echo "Apache is now load balancing across STAR workers on ports 8001-8003"
echo "Access STAR at: http://$(hostname -I | awk '{print $1}')"
echo "Balancer status: http://localhost/balancer-manager"
