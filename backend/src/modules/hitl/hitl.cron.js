const cron = require('node-cron');
const logger = require('../../utils/logger');

function startHITLCron(pool, broadcastToTenant) {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const result = await pool.query(`
        SELECT id, tenant_id FROM conversations
        WHERE mode = 'human'
        AND mode_changed_at < NOW() - INTERVAL '30 minutes'
      `);
      if (result.rows.length === 0) return;
      logger.info(`HITL cron: auto-resetting ${result.rows.length} idle conversations to AI mode`);
      for (const conv of result.rows) {
        await pool.query(`
          UPDATE conversations
          SET mode = 'ai', mode_changed_at = NOW()
          WHERE id = $1 AND tenant_id = $2
        `, [conv.id, conv.tenant_id]);
        broadcastToTenant(conv.tenant_id, 'mode_changed', {
          conversationId: conv.id,
          mode: 'ai',
          reason: 'auto_reset'
        });
      }
    } catch (err) {
      console.error('HITL cron error:', err);
    }
  });
  logger.info('HITL auto-reset cron started');
}

module.exports = { startHITLCron };
