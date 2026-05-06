// SmartMatchEngine - Production Ready + AI Fallback
class SmartMatchEngine {
  constructor({ pool, logger = console, config = {}, aiProvider = null, debug = false }) {
    if (!pool) throw new Error('DB pool is required');

    this.pool = pool;
    this.logger = logger;
    this.debug = debug;
    this.aiProvider = aiProvider;

    this.config = {
      thresholds: {
        client: 60,
        global: 75,
        algorithm: 50,
        safety: 45,
        ...config.thresholds
      },
      cacheTTL: config.cacheTTL || 60000,
      maxBatchSize: config.maxBatchSize || 500,
      boostRules: config.boostRules || [
        { columnFragment: 'cust', targetFragment: 'customer', boost: 15 },
        { columnFragment: 'job', targetFragment: 'job', boost: 10 },
        { columnFragment: 'addr', targetFragment: 'address', boost: 15 },
        { columnFragment: 'phone', targetFragment: 'phone', boost: 15 },
        { columnFragment: 'email', targetFragment: 'email', boost: 15 }
      ]
    };

    this.cache = {
      targetFields: null,
      targetFieldsTS: 0,
      clientMappings: new Map(),
      globalMappings: { data: null, ts: 0 }
    };
  }

  log(...args) {
    if (this.debug) this.logger.log(...args);
  }

  error(...args) {
    this.logger.error(...args);
  }

  // ================= CACHE INVALIDATION =================
  invalidateCache(clientId = null) {
    this.cache.targetFields = null;
    this.cache.targetFieldsTS = 0;
    this.cache.globalMappings = { data: null, ts: 0 };
    if (clientId) {
      this.cache.clientMappings.delete(clientId);
      this.log(`Cache invalidated for client ${clientId}`);
    } else {
      this.cache.clientMappings.clear();
      this.log('Full cache invalidated');
    }
  }

  // ================= SIMILARITY =================
  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) return 100;

    const m = s1.length;
    const n = s2.length;

    let prev = Array(n + 1).fill(0).map((_, i) => i);
    let curr = Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }

    const distance = prev[n];
    const maxLen = Math.max(m, n);
    return Math.round(((maxLen - distance) / maxLen) * 100);
  }

  extractBaseWords(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !['the','a','an','field','column','data','value'].includes(w));
  }

  getDisplayName(field) {
    if (field.startsWith('stakeholder_')) {
      const type = field.replace('stakeholder_', '').replace(/_/g, ' ');
      return `Stakeholder: ${type.replace(/\b\w/g, l => l.toUpperCase())}`;
    }
    return field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  // ================= GUARDS =================
  isAddressColumn(name, sample) {
    if (/street|road|lane|ave|avenue|blvd|address/i.test(name)) return true;
    if (sample && typeof sample === 'string' && /\d.*(street|road|lane|ave)/i.test(sample)) return true;
    return false;
  }

  isDateColumn(name, sample) {
    if (/date|year|month|day|created|updated|timestamp/i.test(name)) return true;
    if (sample && typeof sample === 'string' && /^\d{1,4}[\/-]/.test(sample)) return true;
    return false;
  }

  isInvalidName(name, sample) {
    if (this.isAddressColumn(name, sample)) return true;
    if (this.isDateColumn(name, sample)) return true;
    
    const projectKeywords = ['project', 'job', 'assess', 'type', 'number', 'id', 'code', 'status'];
    if (projectKeywords.some(k => name.toLowerCase().includes(k))) return true;
    
    if (sample && typeof sample === 'string') {
      if (!/[a-z]/i.test(sample) || sample.length > 100) return true;
    }
    return false;
  }

  // ================= CACHE HELPERS =================
  async getTargetFields() {
    if (this.cache.targetFields && Date.now() - this.cache.targetFieldsTS < this.config.cacheTTL) {
      return this.cache.targetFields;
    }

    const res = await this.pool.query(
      `SELECT target_field FROM mapping_definitions WHERE category != 'ignore' ORDER BY sort_order`
    );
    this.cache.targetFields = res.rows.map(r => r.target_field);
    this.cache.targetFieldsTS = Date.now();
    this.log(`Loaded ${this.cache.targetFields.length} target fields`);
    return this.cache.targetFields;
  }

  async getClientMappings(clientId) {
    if (this.cache.clientMappings.has(clientId)) {
      this.log(`Cache hit for client ${clientId}`);
      return this.cache.clientMappings.get(clientId);
    }

    const res = await this.pool.query(`
      SELECT excel_column, target_field, (mapping_name = 'Default') as is_default
      FROM column_mappings WHERE client_id = $1
    `, [clientId]);

    this.cache.clientMappings.set(clientId, res.rows);
    this.log(`Loaded ${res.rows.length} mappings for client ${clientId}`);
    return res.rows;
  }

  async getGlobalMappings(excludeClientId) {
    if (this.cache.globalMappings.data && Date.now() - this.cache.globalMappings.ts < this.config.cacheTTL) {
      this.log('Cache hit for global mappings');
      return this.cache.globalMappings.data;
    }

    const res = await this.pool.query(`
      SELECT excel_column, target_field, FALSE as is_default
      FROM column_mappings WHERE client_id != $1 LIMIT 10000
    `, [excludeClientId]);

    this.cache.globalMappings = { data: res.rows, ts: Date.now() };
    this.log(`Loaded ${res.rows.length} global mappings`);
    return res.rows;
  }

  // ================= MATCHING =================
  findBest(rows, column, threshold, source, hasDefault = false) {
    let best = null;
    let top = 0;

    for (const r of rows) {
      let score = this.calculateSimilarity(column, r.excel_column);
      if (hasDefault && r.is_default) score = Math.min(score + 20, 100);

      if (score >= threshold && score > top) {
        top = score;
        best = { target_field: r.target_field, similarity: score, source };
      }
    }
    return best;
  }

  async level1(column, clientId) {
    const rows = await this.getClientMappings(clientId);
    const hasDefault = rows.some(r => r.is_default);
    return this.findBest(rows, column, this.config.thresholds.client, 'client-memory', hasDefault);
  }

  async level2(column, clientId) {
    const rows = await this.getGlobalMappings(clientId);
    return this.findBest(rows, column, this.config.thresholds.global, 'global-memory');
  }

  level3(column, targetFields) {
    const colLower = column.toLowerCase();
    let best = null;
    let top = 0;

    for (const field of targetFields) {
      const display = this.getDisplayName(field);
      let score = this.calculateSimilarity(column, display);

      const words = new Set(this.extractBaseWords(column));
      for (const w of this.extractBaseWords(display)) {
        if (words.has(w)) score += 10;
      }

      for (const rule of this.config.boostRules) {
        if (colLower.includes(rule.columnFragment) && display.toLowerCase().includes(rule.targetFragment)) {
          score += rule.boost;
        }
      }

      score = Math.min(score, 100);

      if (score > top && score > this.config.thresholds.algorithm) {
        top = score;
        best = { target_field: field, similarity: score, source: 'algorithm' };
      }
    }

    return best;
  }

  level4(column, sample) {
    if (this.isInvalidName(column, sample)) return null;

    const variants = ['customer name', 'client name', 'company name', 'name'];
    let best = 0;

    for (const v of variants) {
      best = Math.max(best, this.calculateSimilarity(column, v));
    }

    if (best > this.config.thresholds.safety) {
      this.log(`🛡️ Level 4 Match: "${column}" → customer_name (${best}%)`);
      return { target_field: 'customer_name', similarity: best, source: 'safety-net' };
    }

    return null;
  }

  // ================= AI FALLBACK =================
  async level5AI(column, sample, targetFields) {
    if (!this.aiProvider) return null;

    try {
      const suggestion = await this.aiProvider.matchColumn({ column, sample, targetFields });
      if (suggestion && targetFields.includes(suggestion)) {
        this.log(`🤖 AI Fallback: "${column}" → ${suggestion}`);
        return { target_field: suggestion, similarity: 80, source: 'ai' };
      }
    } catch (err) {
      this.error('AI fallback failed:', err.message);
    }

    return null;
  }

  // ================= MAIN ORCHESTRATION =================
  async smartMatch(column, clientId, sample, targetFields = null) {
    if (!column || !clientId) return null;

    try {
      let match = await this.level1(column, clientId);
      if (match) return match;

      match = await this.level2(column, clientId);
      if (match) return match;

      const fields = targetFields || await this.getTargetFields();

      match = this.level3(column, fields);
      if (match) return match;

      match = this.level4(column, sample);
      if (match) return match;

      return await this.level5AI(column, sample, fields);
    } catch (err) {
      this.error('SmartMatch failed:', { column, clientId, error: err.message });
      return null;
    }
  }

  async batchSmartMatch(columns, clientId, sampleMap) {
    if (!Array.isArray(columns)) throw new Error('columns must be an array');
    if (columns.length > this.config.maxBatchSize) {
      throw new Error(`Batch size exceeded. Max allowed: ${this.config.maxBatchSize}`);
    }

    const fields = await this.getTargetFields();
    const sampleData = sampleMap || {};

    const results = await Promise.all(columns.map(async c => {
      const sample = sampleData[c];
      const m = await this.smartMatch(c, clientId, sample, fields);
      return m ? [c, m.target_field] : null;
    }));

    return Object.fromEntries(results.filter(Boolean));
  }
}

module.exports = SmartMatchEngine;