// smartMatchEngine.js - Optimized 4-Level Matching Engine
// Level 1: Local Client Memory (Highest Priority)
// Level 2: Global System Memory
// Level 3: Algorithmic Fallback (Similarity Scoring - UPGRADED)
// Level 4: Required Field Safety Net (Brute Force with Guardrails)

class SmartMatchEngine {
  constructor(pool) {
    this.pool = pool;
  }

  // ==================== UTILITY FUNCTIONS ====================
  
  /**
   * Optimized similarity calculation using a two-row Levenshtein approach.
   * This reduces space complexity for better performance during batch processing.
   */
  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    
    if (s1 === s2) return 100;

    const m = s1.length;
    const n = s2.length;
    let prevRow = Array(n + 1).fill(0).map((_, i) => i);
    let currRow = Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
      currRow[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        currRow[j] = Math.min(
          prevRow[j] + 1,      // deletion
          currRow[j - 1] + 1,  // insertion
          prevRow[j - 1] + cost // substitution
        );
      }
      prevRow = [...currRow];
    }

    const distance = prevRow[n];
    const maxLen = Math.max(m, n);
    return Math.round(((maxLen - distance) / maxLen) * 100);
  }

  /**
   * Extract base words from column name (remove common prefixes/suffixes)
   * Used for boosting similarity scores in Level 3
   */
  extractBaseWords(columnName) {
    const cleaned = columnName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const words = cleaned.split(' ');
    const ignoredWords = ['the', 'a', 'an', 'field', 'column', 'data', 'value'];
    return words.filter(w => !ignoredWords.includes(w) && w.length > 2);
  }

  /**
   * Identifies if a column likely contains dates or addresses to prevent 
   * false positives in identity matching (Level 4 Guardrail).
   */
  isLikelyInvalidForName(columnName, sampleData) {
    const lowerCol = columnName.toLowerCase();
    const addressKeywords = ['street', 'ave', 'blvd', 'rd', 'suite', 'zip', 'postal', 'address', 'city', 'state'];
    const dateKeywords = ['date', 'year', 'month', 'time', 'day', 'created', 'updated'];

    // Guardrail: Reject if keywords suggest a different domain
    if (addressKeywords.some(k => lowerCol.includes(k))) return true;
    if (dateKeywords.some(k => lowerCol.includes(k))) return true;
    
    // Guardrail: Validate sample data structure
    if (sampleData && typeof sampleData === 'string') {
      const hasLetters = /[a-zA-Z]/.test(sampleData);
      // Valid names should contain letters and not be excessively long
      if (!hasLetters || sampleData.length > 100) return true;
    }
    return false;
  }

  /**
   * Check if column is likely an address (for validation)
   */
  isAddressColumn(columnName, sampleData) {
    const addressKeywords = ['street', 'st', 'avenue', 'ave', 'blvd', 'boulevard', 'road', 'rd', 'lane', 'ln', 'drive', 'dr', 'court', 'ct', 'way'];
    const nameLower = columnName.toLowerCase();
    
    for (const keyword of addressKeywords) {
      if (nameLower.includes(keyword)) return true;
    }
    
    if (sampleData && typeof sampleData === 'string') {
      const hasNumber = /\d/.test(sampleData);
      const hasStreetKeyword = addressKeywords.some(k => sampleData.toLowerCase().includes(k));
      if (hasNumber && hasStreetKeyword) return true;
    }
    return false;
  }

  /**
   * Check if column is likely a date
   */
  isDateColumn(columnName, sampleData) {
    const dateKeywords = ['date', 'day', 'month', 'year'];
    const nameLower = columnName.toLowerCase();
    
    for (const keyword of dateKeywords) {
      if (nameLower.includes(keyword)) return true;
    }
    
    if (sampleData && typeof sampleData === 'string') {
      const datePattern = /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/;
      if (datePattern.test(sampleData)) return true;
    }
    return false;
  }

  // Helper to process rows and find the best candidate above a threshold
  findBestMatchInRows(columnName, rows, threshold, sourceLabel, isDefault = false) {
    let bestMatch = null;
    let topScore = 0;

    for (const row of rows) {
      const score = this.calculateSimilarity(columnName, row.excel_column);
      let finalScore = score;
      
      // Boost score by 20% if this is from a Default template
      if (isDefault && row.is_default) {
        finalScore = Math.min(score + 20, 100);
      }
      
      if (finalScore >= threshold && finalScore > topScore) {
        topScore = finalScore;
        bestMatch = { 
          target_field: row.target_field, 
          similarity: finalScore, 
          source: sourceLabel,
          originalSimilarity: score
        };
      }
    }
    return bestMatch;
  }

  // ==================== LEVEL 1: LOCAL CLIENT MEMORY ====================
  async analyzeClientTemplates(clientId, columnName) {
    try {
      // Get all mapping templates for this client with default flag
      const result = await this.pool.query(
        `SELECT DISTINCT cm.target_field, cm.excel_column, 
          (cm.mapping_name = 'Default') as is_default
         FROM column_mappings cm
         WHERE cm.client_id = $1`,
        [clientId]
      );
      
      if (result.rows.length === 0) return null;
      
      // Check if there's a Default template to prioritize
      const hasDefault = result.rows.some(r => r.is_default);
      
      // Process with threshold 70% for client memory (more lenient)
      const bestMatch = this.findBestMatchInRows(columnName, result.rows, 60, 'client-memory', hasDefault);
      
      if (bestMatch) {
        console.log(`📊 Level 1 Match: "${columnName}" → ${bestMatch.target_field} (${bestMatch.similarity}%)`);
      }
      
      return bestMatch;
    } catch (err) {
      console.error('Level 1 Error:', err.message);
      return null;
    }
  }

  // ==================== LEVEL 2: GLOBAL SYSTEM MEMORY ====================
  async analyzeGlobalTemplates(columnName, excludeClientId) {
    try {
      const result = await this.pool.query(
        `SELECT DISTINCT target_field, excel_column 
         FROM column_mappings 
         WHERE client_id != $1`,
        [excludeClientId]
      );
      
      if (result.rows.length === 0) return null;
      
      // Global matches require a higher confidence threshold (75%)
      const bestMatch = this.findBestMatchInRows(columnName, result.rows, 75, 'global-memory');
      
      if (bestMatch) {
        console.log(`📊 Level 2 Match: "${columnName}" → ${bestMatch.target_field} (${bestMatch.similarity}%)`);
      }
      
      return bestMatch;
    } catch (err) {
      console.error('Level 2 Error:', err.message);
      return null;
    }
  }

  // ==================== LEVEL 3: ALGORITHMIC FALLBACK (UPGRADED) ====================
  async analyzeWithSimilarity(columnName, targetFields) {
    const results = [];
    
    for (const targetField of targetFields) {
      // Get the display name for this target field
      let displayName = this.getDisplayNameForTargetField(targetField);
      
      let similarity = this.calculateSimilarity(columnName, displayName);
      
      // Extract base words for better matching
      const columnBaseWords = this.extractBaseWords(columnName);
      const targetBaseWords = this.extractBaseWords(displayName);
      
      // Boost similarity if base words match
      let boost = 0;
      for (const colWord of columnBaseWords) {
        for (const targetWord of targetBaseWords) {
          if (colWord === targetWord || targetWord.includes(colWord) || colWord.includes(targetWord)) {
            boost += 10;
          }
        }
      }
      
      // Handle special case: "CustCity" vs "Customer City" vs "Job City"
      if (columnName.toLowerCase().includes('cust') && displayName.toLowerCase().includes('customer')) {
        boost += 15;
      }
      if (columnName.toLowerCase().includes('job') && displayName.toLowerCase().includes('job')) {
        boost += 10;
      }
      
      const finalSimilarity = Math.min(similarity + boost, 100);
      
      results.push({
        target_field: targetField,
        display_name: displayName,
        similarity: finalSimilarity,
        originalSimilarity: similarity
      });
    }
    
    // Sort by similarity score
    results.sort((a, b) => b.similarity - a.similarity);
    
    // Return matches above 50% threshold
    const topMatches = results.filter(r => r.similarity > 50);
    
    if (topMatches.length > 0) {
      const bestMatch = topMatches[0];
      console.log(`📊 Level 3 Match: "${columnName}" → ${bestMatch.target_field} (${bestMatch.similarity}%, boost: ${bestMatch.similarity - bestMatch.originalSimilarity})`);
      return { 
        target_field: bestMatch.target_field, 
        similarity: bestMatch.similarity, 
        source: 'algorithm',
        display_name: bestMatch.display_name
      };
    }
    
    return null;
  }

  getDisplayNameForTargetField(targetField) {
    const displayNames = {
      'customer_name': 'Customer Name',
      'project_name': 'Project Name',
      'project_id': 'Project Number',
      'project_type': 'Project Type',
      'assess_type': 'Assessment Type',
      'address': 'Address',
      'city': 'City',
      'state': 'State/Province',
      'cust_country': 'Customer Country',
      'job_address': 'Job Address',
      'job_city': 'Job City',
      'job_state': 'Job State/Province',
      'job_country': 'Job Country',
      'contractor_name': 'Contractor Name',
      'contractor_phone': 'Contractor Phone',
      'contractor_company': 'Contractor Company',
      'start_date': 'Start Date',
      'completion_date': 'Completion Date',
      'project_value': 'Project Value',
      'project_stage': 'Project Stage',
      'primary_contact_name': 'Primary Contact Name',
      'primary_phone': 'Primary Phone',
      'primary_email': 'Primary Email',
      'secondary_contact_name': 'Secondary Contact Name',
      'secondary_phone': 'Secondary Phone',
      'secondary_email': 'Secondary Email',
      'extra_info': 'Extra Notes',
      'ci_note': 'Internal Notes',
      'custom_field': 'Custom Field'
    };
    
    // Handle stakeholder fields
    if (targetField.startsWith('stakeholder_')) {
      const type = targetField.replace('stakeholder_', '').replace(/_/g, ' ');
      return `Stakeholder: ${type.replace(/\b\w/g, l => l.toUpperCase())}`;
    }
    
    return displayNames[targetField] || targetField.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  // ==================== LEVEL 4: REQUIRED FIELD SAFETY NET ====================
  async findCustomerNameWithGuardrails(columnName, sampleData) {
    // Reject address columns
    if (this.isAddressColumn(columnName, sampleData)) {
      console.log(`🛡️ Rejected "${columnName}" for customer_name: appears to be an address`);
      return null;
    }
    
    // Reject date columns
    if (this.isDateColumn(columnName, sampleData)) {
      console.log(`🛡️ Rejected "${columnName}" for customer_name: appears to be a date`);
      return null;
    }
    
    // Use the existing guardrail function
    if (this.isLikelyInvalidForName(columnName, sampleData)) {
      console.log(`🛡️ Rejected "${columnName}" for customer_name: guardrail triggered`);
      return null;
    }
    
    // Calculate similarity with "Customer Name" variants
    const nameVariants = [
      'Customer Name', 'Client Name', 'Company Name', 'Account Name',
      'Customer', 'Client', 'Company', 'Account', 'Business Name',
      'Name', 'Full Name', 'Legal Name'
    ];
    
    let bestSimilarity = 0;
    let bestMatch = null;
    
    for (const variant of nameVariants) {
      const similarity = this.calculateSimilarity(columnName, variant);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = variant;
      }
    }
    
    // Safety net threshold is 45% (lower than other levels) but protected by guardrails
    if (bestSimilarity > 45) {
      console.log(`🛡️ Level 4 Match: "${columnName}" → customer_name (${bestSimilarity}%)`);
      return { target_field: 'customer_name', similarity: bestSimilarity, source: 'safety-net' };
    }
    
    return null;
  }

  // ==================== GET ALL TARGET FIELDS ====================
  async getAllTargetFields() {
    try {
      const result = await this.pool.query(
        `SELECT target_field FROM mapping_definitions WHERE category != 'ignore' ORDER BY sort_order`
      );
      return result.rows.map(r => r.target_field);
    } catch (err) {
      console.error('Error getting target fields:', err.message);
      return [];
    }
  }

  // ==================== MAIN ORCHESTRATION ====================
  async smartMatch(columnName, clientId, sampleData) {
    console.log(`\n🔍 Smart Matching: "${columnName}" for client ${clientId}`);
    
    // Level 1: Local Client Memory
    let match = await this.analyzeClientTemplates(clientId, columnName);
    if (match) return match;

    // Level 2: Global System Memory
    match = await this.analyzeGlobalTemplates(columnName, clientId);
    if (match) return match;

    // Level 3: Algorithmic Fallback (Upgraded Dictionary with similarity scoring)
    const targetFields = await this.getAllTargetFields();
    match = await this.analyzeWithSimilarity(columnName, targetFields);
    if (match) return match;

    // Level 4: Required Field Safety Net with Guardrails
    // Specifically targets 'customer_name' if no prior match is found
    match = await this.findCustomerNameWithGuardrails(columnName, sampleData);
    if (match) return match;

    console.log(`❌ No match found for "${columnName}"`);
    return null;
  }

  // ==================== BATCH SMART MATCH ====================
  async batchSmartMatch(columns, clientId, sampleDataMap) {
    const results = {};
    const allTargetFields = await this.getAllTargetFields();
    
    for (const column of columns) {
      const sampleData = sampleDataMap[column];
      const match = await this.smartMatch(column, clientId, sampleData, allTargetFields);
      if (match) {
        results[column] = match.target_field;
      }
    }
    return results;
  }

  // ==================== GET CLIENT TEMPLATE ANALYTICS ====================
  async getClientAnalytics(clientId) {
    try {
      const templatesResult = await this.pool.query(
        `SELECT mapping_name, COUNT(*) as mapping_count 
         FROM column_mappings 
         WHERE client_id = $1 
         GROUP BY mapping_name`,
        [clientId]
      );
      
      const defaultResult = await this.pool.query(
        `SELECT mapping_name FROM column_mappings 
         WHERE client_id = $1 AND mapping_name = 'Default' 
         LIMIT 1`,
        [clientId]
      );
      
      return {
        clientId,
        totalTemplates: templatesResult.rows.length,
        templates: templatesResult.rows,
        defaultTemplate: defaultResult.rows[0]?.mapping_name || null
      };
    } catch (err) {
      console.error('Analytics error:', err.message);
      return null;
    }
  }
}

module.exports = SmartMatchEngine;