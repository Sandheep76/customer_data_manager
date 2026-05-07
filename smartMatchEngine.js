// SmartMatchEngine - Fixed Complex Version
// All advanced features but with balanced strictness

class SmartMatchEngine {
  constructor({ pool, logger = console, config = {}, aiProvider = null, debug = false }) {
    if (!pool) throw new Error('DB pool is required');

    this.pool = pool;
    this.logger = logger;
    this.debug = debug;
    this.aiProvider = aiProvider;

    this.config = {
      thresholds: {
        client: 50,
        global: 60,
        algorithm: config.thresholds?.algorithm || 45,
        safety: 40,
        ...config.thresholds
      },
      cacheTTL: config.cacheTTL || 60000,
      maxBatchSize: config.maxBatchSize || 500,
      maxConcurrency: config.maxConcurrency || 10,
      similarityCacheSize: config.similarityCacheSize || 5000,
      fieldCardinality: {
        'single': ['customer_name', 'project_name', 'project_id', 'project_type', 'assess_type'],
        'multiple': ['primary_phone', 'secondary_phone', 'primary_email', 'secondary_email', 'contractor_phone']
      },
      tokenWeights: {
        'customer': 15, 'client': 12, 'company': 12, 'business': 10, 'name': 8,
        'address': 15, 'street': 12, 'city': 10, 'state': 10, 'country': 10,
        'phone': 15, 'mobile': 12, 'email': 20,
        'project': 12, 'job': 10, 'type': 5
      }
    };

    // Domain categories
    this.domains = {
      'email': ['email', 'primary_email', 'secondary_email'],
      'phone': ['phone', 'primary_phone', 'secondary_phone', 'contractor_phone'],
      'address': ['address', 'job_address', 'cust_country', 'job_country', 'city', 'state', 'job_city', 'job_state'],
      'name': ['customer_name', 'project_name', 'contractor_name', 'primary_contact_name', 'secondary_contact_name'],
      'project': ['project_name', 'project_id', 'project_type', 'project_stage']
    };

    // Build domain lookup
    this.fieldToDomain = {};
    for (const [domain, fields] of Object.entries(this.domains)) {
      for (const field of fields) this.fieldToDomain[field] = domain;
    }

    // Compatible domains (no penalty)
    this.compatibleDomains = {
      'name': ['name', 'project'],
      'project': ['name', 'project'],
      'address': ['address'],
      'phone': ['phone'],
      'email': ['email']
    };

    // Synonym engine
    this.synonyms = {
      customer: ['client', 'account', 'company', 'business'],
      phone: ['mobile', 'telephone', 'contact'],
      email: ['mail', 'emailaddress'],
      address: ['location', 'street', 'addr'],
      project: ['job', 'work']
    };

    // Bounded LRU similarity cache
    this.similarityCache = new BoundedLRUCache(this.config.similarityCacheSize);
    
    // Main caches
    this.cache = {
      targetFields: null,
      targetFieldsTS: 0,
      clientMappings: new LRUCache({ max: 1000, ttl: 1000 * 60 * 10 }),
      globalMappings: { data: null, ts: 0 }
    };

    // Performance metrics
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      similarityCacheHits: 0,
      similarityCacheMisses: 0,
      prunedCandidates: 0,
      aiCalls: 0,
      totalMatches: 0,
      failedMatches: 0,
      globalOptimizations: 0
    };
  }

  log(...args) { if (this.debug) this.logger.log(...args); }
  error(...args) { this.logger.error(...args); }

  normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[_\-.]/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  expandAcronyms(text) {
    const map = {
      cust: 'customer', addr: 'address', tel: 'telephone', ph: 'phone',
      qty: 'quantity', amt: 'amount', info: 'information', num: 'number', id: 'identifier'
    };
    let normalized = this.normalize(text);
    for (const [short, full] of Object.entries(map)) {
      normalized = normalized.replace(new RegExp(`\\b${short}\\b`, 'g'), full);
    }
    return normalized;
  }

  extractBaseWords(text) {
    const stopWords = new Set(['the', 'a', 'an', 'field', 'column', 'data', 'value', 'info', 'details']);
    return [...new Set(this.normalize(text).split(' ').filter(w => w.length > 2 && !stopWords.has(w)))];
  }

  getSemanticGroups(text) {
    const semanticGroups = {
      'customer_entity': ['customer', 'client', 'company', 'business', 'account'],
      'contact': ['phone', 'mobile', 'telephone', 'email', 'mail'],
      'location': ['address', 'street', 'city', 'state', 'country', 'province'],
      'project_entity': ['project', 'job', 'work', 'task']
    };
    
    const words = this.extractBaseWords(text);
    const groups = new Set();
    
    for (const word of words) {
      for (const [groupName, groupWords] of Object.entries(semanticGroups)) {
        if (groupWords.includes(word) || word === groupName) {
          groups.add(groupName);
        }
      }
      groups.add(word);
    }
    return groups;
  }

  calculateSimilarityRaw(str1, str2) {
    if (!str1 || !str2) return { final: 0, explanation: 'No input data', components: {} };
    
    const s1 = this.expandAcronyms(str1);
    const s2 = this.expandAcronyms(str2);
    const normalized1 = s1.toLowerCase().trim();
    const normalized2 = s2.toLowerCase().trim();

    // Exact match
    if (normalized1 === normalized2) {
      return { final: 100, explanation: 'Exact match', components: { exact: 100 } };
    }

    // Contains match
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
      const shorter = Math.min(normalized1.length, normalized2.length);
      const longer = Math.max(normalized1.length, normalized2.length);
      const containsScore = Math.round((shorter / longer) * 70) + 20;
      return { final: Math.min(containsScore, 95), explanation: 'Contains match', components: { contains: containsScore } };
    }

    // Levenshtein distance
    const m = normalized1.length, n = normalized2.length;
    let prev = Array(n + 1).fill(0).map((_, i) => i);
    let curr = Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = normalized1[i - 1] === normalized2[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }
    const distance = prev[n];
    const maxLen = Math.max(m, n);
    let levenshteinScore = Math.round(((maxLen - distance) / maxLen) * 100);
    
    // Token overlap (bonus)
    const tokens1 = new Set(this.extractBaseWords(str1));
    const tokens2 = new Set(this.extractBaseWords(str2));
    let overlap = 0;
    for (const t of tokens1) {
      if (tokens2.has(t)) overlap += 8;
    }
    const tokenBonus = Math.min(overlap, 25);
    
    // Semantic boost (bonus)
    const semanticGroups1 = this.getSemanticGroups(str1);
    const semanticGroups2 = this.getSemanticGroups(str2);
    let semanticOverlap = 0;
    for (const g of semanticGroups1) {
      if (semanticGroups2.has(g)) semanticOverlap += 12;
    }
    const semanticBonus = Math.min(semanticOverlap, 25);
    
    let finalScore = Math.min(levenshteinScore + tokenBonus + semanticBonus, 100);
    
    // Ensure minimum for reasonable matches
    if (levenshteinScore > 40 && finalScore < 45) finalScore = 45;
    
    return {
      final: finalScore,
      explanation: `Levenshtein: ${levenshteinScore}% + Token: ${tokenBonus}% + Semantic: ${semanticBonus}%`,
      components: { levenshtein: levenshteinScore, tokenBonus, semanticBonus }
    };
  }

  getCachedSimilarity(str1, str2) {
    const key = `${str1}|${str2}`;
    if (this.similarityCache.has(key)) {
      this.metrics.similarityCacheHits++;
      return this.similarityCache.get(key);
    }
    this.metrics.similarityCacheMisses++;
    const result = this.calculateSimilarityRaw(str1, str2);
    this.similarityCache.set(key, result);
    return result;
  }

  // Simple pruning - only for completely incompatible domains
  quickPrune(column, targetField, sampleStats = null) {
    const columnDomain = this.detectColumnDomain(column, sampleStats);
    const targetDomain = this.fieldToDomain[targetField];
    if (columnDomain && targetDomain && columnDomain !== targetDomain) {
      const compatible = this.compatibleDomains[columnDomain] || [];
      if (!compatible.includes(targetDomain)) {
        const columnWords = new Set(this.extractBaseWords(column));
        const targetWords = new Set(this.extractBaseWords(targetField));
        for (const w of columnWords) {
          if (targetWords.has(w)) return true;
        }
        this.metrics.prunedCandidates++;
        return false;
      }
    }
    return true;
  }

  detectColumnDomain(column, sampleStats = null) {
    const colLower = column.toLowerCase();
    
    if (colLower.includes('email')) return 'email';
    if (colLower.includes('phone') || colLower.includes('mobile')) return 'phone';
    if (colLower.includes('address') || colLower.includes('street') || colLower.includes('city') || 
        colLower.includes('state') || colLower.includes('country')) return 'address';
    if (colLower.includes('customer') || colLower.includes('client') || colLower.includes('company') || 
        colLower.includes('business') || colLower.includes('name')) return 'name';
    if (colLower.includes('project') || colLower.includes('job')) return 'project';
    return null;
  }

  getDomainPenalty(column, targetField, sampleStats = null) {
    const columnDomain = this.detectColumnDomain(column, sampleStats);
    const targetDomain = this.fieldToDomain[targetField];
    if (!columnDomain || !targetDomain) return 0;
    if (columnDomain === targetDomain) return 0;
    
    const compatible = this.compatibleDomains[columnDomain] || [];
    if (compatible.includes(targetDomain)) return 0;
    
    return 15; // Reduced penalty
  }

  applyPenalties(column, targetField, currentScore, sampleStats = null) {
    let penaltyTotal = this.getDomainPenalty(column, targetField, sampleStats);
    
    if (sampleStats && sampleStats.isEmail && !targetField.includes('email')) penaltyTotal += 20;
    if (sampleStats && sampleStats.isPhone && !targetField.includes('phone')) penaltyTotal += 15;
    
    return Math.max(currentScore - penaltyTotal, 0);
  }

  getConfidence(score) {
    if (score >= 85) return 'high';
    if (score >= 65) return 'medium';
    return 'low';
  }

  getDisplayName(field) {
    const specialNames = {
      'customer_name': 'Customer Name',
      'address': 'Street Address',
      'job_address': 'Job Site Address',
      'project_type': 'Project Type'
    };
    if (specialNames[field]) return specialNames[field];
    if (field.startsWith('stakeholder_')) {
      const type = field.replace('stakeholder_', '').replace(/_/g, ' ');
      return `Stakeholder: ${type.replace(/\b\w/g, l => l.toUpperCase())}`;
    }
    return field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  isTargetAllowed(targetField, usedTargets) {
    const singleFields = new Set(this.config.fieldCardinality.single);
    if (singleFields.has(targetField)) return !usedTargets.has(targetField);
    return true;
  }

  async getTargetFields() {
    if (this.cache.targetFields && Date.now() - this.cache.targetFieldsTS < this.config.cacheTTL) {
      this.metrics.cacheHits++;
      return this.cache.targetFields;
    }
    this.metrics.cacheMisses++;
    const res = await this.pool.query(
      `SELECT target_field FROM mapping_definitions WHERE category != 'ignore' ORDER BY sort_order`
    );
    this.cache.targetFields = res.rows.map(r => r.target_field);
    this.cache.targetFieldsTS = Date.now();
    return this.cache.targetFields;
  }

  async getClientMappings(clientId) {
    if (this.cache.clientMappings.has(clientId)) {
      this.metrics.cacheHits++;
      this.cache.clientMappings.get(clientId);
      return this.cache.clientMappings.get(clientId);
    }
    this.metrics.cacheMisses++;
    const res = await this.pool.query(`
      SELECT excel_column, target_field, (mapping_name = 'Default') as is_default
      FROM column_mappings WHERE client_id = $1
    `, [clientId]);
    this.cache.clientMappings.set(clientId, res.rows);
    return res.rows;
  }

  async getGlobalMappings(excludeClientId) {
    if (this.cache.globalMappings.data && Date.now() - this.cache.globalMappings.ts < this.config.cacheTTL) {
      this.metrics.cacheHits++;
      return this.cache.globalMappings.data;
    }
    this.metrics.cacheMisses++;
    const res = await this.pool.query(`
      SELECT excel_column, target_field
      FROM column_mappings WHERE client_id != $1 LIMIT 10000
    `, [excludeClientId]);
    this.cache.globalMappings = { data: res.rows, ts: Date.now() };
    return res.rows;
  }

  async smartMatch(column, clientId, sample, targetFields = null) {
    if (!column || !clientId) return null;
    
    const sampleStats = sample ? { isEmail: /@/.test(sample), isPhone: /^\d{10,}$/.test(sample) } : null;

    try {
      // Level 1: Client memory
      const clientMappings = await this.getClientMappings(clientId);
      let bestMatch = null;
      let bestScore = 0;
      
      for (const map of clientMappings) {
        const sim = this.getCachedSimilarity(column, map.excel_column);
        let score = sim.final;
        if (map.is_default) score = Math.min(score + 15, 100);
        score = this.applyPenalties(column, map.target_field, score, sampleStats);
        
        if (score >= this.config.thresholds.client && score > bestScore) {
          bestScore = score;
          bestMatch = { target_field: map.target_field, similarity: score, source: 'client-memory' };
        }
      }
      if (bestMatch) return bestMatch;

      // Level 2: Global memory
      const globalMappings = await this.getGlobalMappings(clientId);
      for (const map of globalMappings) {
        const sim = this.getCachedSimilarity(column, map.excel_column);
        const score = this.applyPenalties(column, map.target_field, sim.final, sampleStats);
        if (score >= this.config.thresholds.global && score > bestScore) {
          bestScore = score;
          bestMatch = { target_field: map.target_field, similarity: score, source: 'global-memory' };
        }
      }
      if (bestMatch) return bestMatch;

      // Level 3: Algorithmic
      const fields = targetFields || await this.getTargetFields();
      for (const field of fields) {
        const display = this.getDisplayName(field);
        const sim = this.getCachedSimilarity(column, display);
        const score = this.applyPenalties(column, field, sim.final, sampleStats);
        if (score >= this.config.thresholds.algorithm && score > bestScore) {
          bestScore = score;
          bestMatch = { target_field: field, similarity: score, source: 'algorithm' };
        }
      }
      if (bestMatch) return bestMatch;

      this.metrics.failedMatches++;
      return null;
    } catch (err) {
      this.metrics.failedMatches++;
      this.error('SmartMatch failed:', err.message);
      return null;
    }
  }

  async batchSmartMatch(columns, clientId, sampleMap) {
    if (!Array.isArray(columns)) throw new Error('columns must be an array');
    if (columns.length > this.config.maxBatchSize) {
      throw new Error(`Batch size exceeded. Max allowed: ${this.config.maxBatchSize}`);
    }

    this.similarityCache.clear();
    
    const fields = await this.getTargetFields();
    const results = [];
    const usedTargets = new Set();

    for (const column of columns) {
      const match = await this.smartMatch(column, clientId, null, fields);
      if (match && this.isTargetAllowed(match.target_field, usedTargets)) {
        const singleFields = new Set(this.config.fieldCardinality.single);
        if (singleFields.has(match.target_field)) {
          usedTargets.add(match.target_field);
        }
        results.push([column, match.target_field]);
        this.metrics.totalMatches++;
      }
    }

    return Object.fromEntries(results);
  }

  invalidateCache(clientId = null) {
    this.cache.targetFields = null;
    this.cache.targetFieldsTS = 0;
    this.cache.globalMappings = { data: null, ts: 0 };
    this.similarityCache.clear();
    if (clientId) this.cache.clientMappings.delete(clientId);
    else this.cache.clientMappings.clear();
  }

  getMetrics() { return this.metrics; }
  resetMetrics() {
    this.metrics = {
      cacheHits: 0, cacheMisses: 0, similarityCacheHits: 0, similarityCacheMisses: 0,
      prunedCandidates: 0, aiCalls: 0, totalMatches: 0, failedMatches: 0, globalOptimizations: 0
    };
  }
}

// ================= CACHE CLASSES =================
class BoundedLRUCache {
  constructor(maxSize) { 
    this.maxSize = maxSize || 5000; 
    this.cache = new Map(); 
  }
  has(key) { return this.cache.has(key); }
  get(key) {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }
  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  clear() { this.cache.clear(); }
}

class LRUCache {
  constructor(options) {
    this.max = options.max || 1000;
    this.ttl = options.ttl || 600000;
    this.cache = new Map();
  }
  has(key) { return this.cache.has(key); }
  get(key) {
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }
  set(key, value) {
    if (this.cache.size >= this.max) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }
  delete(key) { this.cache.delete(key); }
  clear() { this.cache.clear(); }
}

module.exports = SmartMatchEngine;