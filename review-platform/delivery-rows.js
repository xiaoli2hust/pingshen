// Budget presence only: no pricing, normalization of stored payloads, or timestamp changes.
const DELIVERY_NUM_KEYS = ['pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost'];
const n0 = value => {
  const n = typeof value === 'number' ? value : Number(String(value == null ? '' : value).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};
function hasBudgetNumbers(row) {
  return DELIVERY_NUM_KEYS.some(key => n0((row || {})[key]) > 0);
}
function pruneEmptyRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(hasBudgetNumbers);
}
function parseRows(json) {
  try {
    const rows = JSON.parse(json || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}
function pruneStoredDelivery(db) {
  const result = {
    opp_delivery: { before: 0, after: 0, changed: 0, demoted: 0 },
    budget_delivery: { before: 0, after: 0, changed: 0 }
  };
  for (const [table, key] of [['opp_delivery', 'opp_code'], ['budget_delivery', 'budget_id']]) {
    const isOpp = table === 'opp_delivery';
    const records = db.prepare(`SELECT ${key},rows_json${isOpp ? ',status' : ''} FROM ${table}`).all();
    const update = db.prepare(`UPDATE ${table} SET rows_json=?${isOpp ? ',status=?' : ''} WHERE ${key}=?`);
    const count = result[table];
    for (const record of records) {
      const before = parseRows(record.rows_json);
      const after = pruneEmptyRows(before);
      count.before += before.length;
      count.after += after.length;
      if (before.length === after.length) continue;
      if (isOpp) {
        const demote = record.status === 'confirmed' && after.length === 0;
        update.run(JSON.stringify(after), demote ? 'draft' : record.status, record[key]);
        if (demote) count.demoted++;
      } else {
        update.run(JSON.stringify(after), record[key]);
      }
      count.changed++;
    }
  }
  return result;
}
module.exports = { DELIVERY_NUM_KEYS, hasBudgetNumbers, pruneEmptyRows, pruneStoredDelivery };
