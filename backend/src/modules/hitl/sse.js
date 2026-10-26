const sseClients = new Map();

function getSseKey(tenantId) {
  return `tenant:${tenantId}`;
}

function addSseClient(tenantId, res) {
  const key = getSseKey(tenantId);
  if (!sseClients.has(key)) sseClients.set(key, new Set());
  sseClients.get(key).add(res);
}

function removeSseClient(tenantId, res) {
  const key = getSseKey(tenantId);
  if (sseClients.has(key)) {
    sseClients.get(key).delete(res);
    if (sseClients.get(key).size === 0) sseClients.delete(key);
  }
}

function broadcastToTenant(tenantId, event, data) {
  const key = getSseKey(tenantId);
  const clients = sseClients.get(key);
  if (!clients) return;
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(message);
    } catch (err) {
      clients.delete(res);
    }
  }
}

// Ends and forgets every live-event connection of one clinic (used when the clinic is deleted). Returns how many were closed.
function closeTenantSseClients(tenantId) {
  const key = getSseKey(tenantId);
  const clients = sseClients.get(key);
  if (!clients) return 0;
  let closed = 0;
  for (const res of clients) {
    try { res.end(); } catch (err) { /* already closed */ }
    closed += 1;
  }
  sseClients.delete(key);
  return closed;
}

module.exports = { addSseClient, removeSseClient, broadcastToTenant, closeTenantSseClients };
