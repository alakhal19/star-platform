#!/bin/bash
# ═══════════════════════════════════════════════════════════
# ELK Stack Setup for STAR on VM3
# Run this on VM3 as root after setup-vm3.sh
# ═══════════════════════════════════════════════════════════

set -e

echo "Setting up ELK stack for STAR..."

# ─── 1. Install Elasticsearch ─────────────────────────
echo "[1/4] Installing Elasticsearch..."
wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | gpg --dearmor -o /usr/share/keyrings/elasticsearch-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/elasticsearch-keyring.gpg] https://artifacts.elastic.co/packages/8.x/apt stable main" | tee /etc/apt/sources.list.d/elastic-8.x.list
apt-get update
apt-get install -y elasticsearch

# Disable security for simplicity (internal network only)
cat >> /etc/elasticsearch/elasticsearch.yml <<EOF
xpack.security.enabled: false
xpack.security.http.ssl.enabled: false
xpack.security.transport.ssl.enabled: false
EOF

systemctl enable elasticsearch
systemctl start elasticsearch
echo "  Elasticsearch installed"

# ─── 2. Install Logstash ──────────────────────────────
echo "[2/4] Installing Logstash..."
apt-get install -y logstash

# Copy STAR pipeline config
cp /opt/star/backend/src/config/logstash-star.conf /etc/logstash/conf.d/star.conf

systemctl enable logstash
systemctl start logstash
echo "  Logstash installed"

# ─── 3. Install Kibana ───────────────────────────────
echo "[3/4] Installing Kibana..."
apt-get install -y kibana

# Allow access from ZeroTier network
sed -i 's/#server.host: "localhost"/server.host: "0.0.0.0"/' /etc/kibana/kibana.yml

systemctl enable kibana
systemctl start kibana
echo "  Kibana installed"

# ─── 4. Install Filebeat ─────────────────────────────
echo "[4/4] Installing Filebeat..."
apt-get install -y filebeat

# Copy STAR filebeat config
cp /opt/star/backend/src/config/filebeat.yml /etc/filebeat/filebeat.yml

systemctl enable filebeat
systemctl start filebeat
echo "  Filebeat installed"

echo ""
echo "═══════════════════════════════════════════════"
echo "  ELK stack setup complete!"
echo ""
echo "  Elasticsearch: http://localhost:9200"
echo "  Kibana:        http://localhost:5601"
echo "  Logstash:      listening on port 5044"
echo "  Filebeat:      shipping from /var/log/star/"
echo ""
echo "  STAR logs will appear in Kibana under"
echo "  index pattern: star-*"
echo "═══════════════════════════════════════════════"