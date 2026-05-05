// excelImporter.js - FULLY MIGRATED TO CLIENT_ID with Formula Injection Protection
const XLSX = require("xlsx");

class ExcelImporter {
  constructor(pool) {
    this.pool = pool;
  }

  // ==================== FORMULA INJECTION PROTECTION ====================
  sanitizeExcelValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value;
    
    const str = String(value).trim();
    if (str === '') return value;
    
    // Check if the string starts with formula injection characters
    const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r'];
    
    // Check for common formula injection patterns
    const formulaPatterns = [
      /^=HYPERLINK\(/i,
      /^=cmd\|/i,
      /^=powershell/i,
      /^=rundll32/i,
      /^=mshta/i,
      /^=wscript/i,
      /^=cscript/i,
      /^=DDE\(/i,
      /^=table\(/i,
      /^=shell\(/i,
      /^=execute\(/i,
      /^=eval\(/i,
    ];
    
    // Check first character
    if (dangerousPrefixes.includes(str.charAt(0))) {
      console.warn(`⚠️ Sanitized potential formula injection: ${str.substring(0, 50)}`);
      return `'${str}`; // Prepend single quote to neutralize
    }
    
    // Check for formula patterns
    for (const pattern of formulaPatterns) {
      if (pattern.test(str)) {
        console.warn(`⚠️ Sanitized potential formula injection: ${str.substring(0, 50)}`);
        return `'${str}`;
      }
    }
    
    return value;
  }

  // Split multiple names using delimiter (prefer ; then & then ,)
  splitMultipleNames(value) {
    if (!value || typeof value !== "string") return [value];
    if (value.includes(";"))
      return value
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s);
    if (value.includes("&"))
      return value
        .split("&")
        .map((s) => s.trim())
        .filter((s) => s);
    if (value.includes(","))
      return value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s);
    return [value];
  }

  // Load mappings from database for specific client and mapping name
  async loadMappingsFromDB(clientId, mappingName) {
    try {
      // UPDATED: Now querying by client_id directly
      const mappingsResult = await this.pool.query(
        `SELECT excel_column, target_field, is_custom_field 
         FROM column_mappings 
         WHERE client_id = $1 AND mapping_name = $2
         ORDER BY excel_column`,
        [clientId, mappingName],
      );

      if (mappingsResult.rows.length === 0) {
        console.log(
          `⚠️ No mappings found for client ID ${clientId}, mapping: ${mappingName}`,
        );
        return null;
      }

      // Initialize all mapping arrays including all new fields
      const mappings = {
        project_name: [],
        project_id: [],
        project_type: [],
        customer_name: [],
        contractor_name: [],
        contractor_phone: [],
        contractor_company: [],
        address: [],
        city: [],
        state: [],
        job_address: [],
        job_city: [],
        job_state: [],
        contacts: {},
        stakeholders: {},
      };

      const rawMappings = {};

      for (const row of mappingsResult.rows) {
        const targetField = row.target_field;
        rawMappings[targetField] = row.excel_column;

        // Categorize mappings by type
        if (targetField === "project_name")
          mappings.project_name = [new RegExp(row.excel_column, "i")];
        else if (
          targetField === "project_id" ||
          targetField === "project_number"
        )
          mappings.project_id = [new RegExp(row.excel_column, "i")];
        else if (targetField === "project_type")
          mappings.project_type = [new RegExp(row.excel_column, "i")];
        else if (targetField === "customer_name")
          mappings.customer_name = [new RegExp(row.excel_column, "i")];
        else if (targetField === "contractor_name")
          mappings.contractor_name = [new RegExp(row.excel_column, "i")];
        else if (targetField === "contractor_phone")
          mappings.contractor_phone = [new RegExp(row.excel_column, "i")];
        else if (targetField === "contractor_company")
          mappings.contractor_company = [new RegExp(row.excel_column, "i")];
        else if (targetField === "address")
          mappings.address = [new RegExp(row.excel_column, "i")];
        else if (targetField === "city")
          mappings.city = [new RegExp(row.excel_column, "i")];
        else if (targetField === "state")
          mappings.state = [new RegExp(row.excel_column, "i")];
        else if (targetField === "job_address")
          mappings.job_address = [new RegExp(row.excel_column, "i")];
        else if (targetField === "job_city")
          mappings.job_city = [new RegExp(row.excel_column, "i")];
        else if (targetField === "job_state")
          mappings.job_state = [new RegExp(row.excel_column, "i")];
        else if (targetField === "primary_contact_name")
          mappings.contacts.primary_name = [new RegExp(row.excel_column, "i")];
        else if (targetField === "primary_phone")
          mappings.contacts.primary_phone = [new RegExp(row.excel_column, "i")];
        else if (targetField === "primary_email")
          mappings.contacts.primary_email = [new RegExp(row.excel_column, "i")];
        else if (targetField === "secondary_contact_name")
          mappings.contacts.secondary_name = [
            new RegExp(row.excel_column, "i"),
          ];
        else if (targetField === "secondary_phone")
          mappings.contacts.secondary_phone = [
            new RegExp(row.excel_column, "i"),
          ];
        else if (targetField === "secondary_email")
          mappings.contacts.secondary_email = [
            new RegExp(row.excel_column, "i"),
          ];
        else if (targetField && targetField.startsWith("stakeholder_")) {
          const stakeholderType = targetField.replace("stakeholder_", "");
          mappings.stakeholders[stakeholderType] = [
            new RegExp(row.excel_column, "i"),
          ];
        }
      }

      console.log(
        `✅ Loaded ${mappingsResult.rows.length} mappings from database for client ID ${clientId}, mapping: ${mappingName}`,
      );
      return { mappings, rawMappings };
    } catch (err) {
      console.error(`❌ Error loading mappings from database:`, err.message);
      return null;
    }
  }

  async getClientDefaults(clientId) {
    const result = await this.pool.query(
      "SELECT default_cust_country, default_job_country FROM clients WHERE id = $1",
      [clientId],
    );
    return {
      cust_country: result.rows[0]?.default_cust_country || "Canada",
      job_country: result.rows[0]?.default_job_country || "Canada",
    };
  }

  // UPDATED: Now queries by client_id
  async getValidAssessTypes(clientId) {
    const result = await this.pool.query(
      "SELECT assess_type FROM assess_types WHERE client_id = $1 AND is_active = true",
      [clientId],
    );
    return result.rows.map((row) => row.assess_type);
  }

  excelDateToJSDate(serial) {
    if (!serial) return null;
    if (serial instanceof Date) return serial;
    if (typeof serial === "number") {
      const utc_days = Math.floor(serial - 25569);
      return new Date(utc_days * 86400000);
    }
    const parsed = new Date(serial);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  matchColumn(columnName, patterns) {
    if (!patterns) return null;
    for (const [key, patternList] of Object.entries(patterns)) {
      if (Array.isArray(patternList)) {
        for (const pattern of patternList) {
          if (pattern.test(columnName)) return key;
        }
      }
    }
    return null;
  }

  extractContacts(row, projectId, mappings, rawMappings) {
    const contacts = [];
    const contactPatterns = mappings.contacts;
    if (!contactPatterns) return contacts;

    let contactData = {};
    for (const [colName, value] of Object.entries(row)) {
      if (!value) continue;
      // SANITIZE the value
      const sanitizedValue = this.sanitizeExcelValue(value);
      const contactType = this.matchColumn(colName, contactPatterns);
      if (contactType) {
        const parts = contactType.split("_");
        const field = parts.length > 1 ? parts[1] : parts[0];
        contactData[field] = sanitizedValue;
      }
    }

    if (contactData.name || contactData.phone || contactData.email) {
      contacts.push({
        project_id: projectId,
        contact_name: this.sanitizeExcelValue(contactData.name) || "Unknown",
        role: this.sanitizeExcelValue(contactData.role) || this.sanitizeExcelValue(contactData.title) || "Contact",
        phone: this.sanitizeExcelValue(contactData.phone) || null,
        email: this.sanitizeExcelValue(contactData.email) || null,
        is_primary: true,
        custom_fields: {
          title: this.sanitizeExcelValue(contactData.title) || null,
          project_role: this.sanitizeExcelValue(contactData.role) || null,
        },
      });
    }
    return contacts;
  }

  extractStakeholders(row, projectId, mappings) {
    const stakeholders = [];
    const stakeholderPatterns = mappings.stakeholders;
    if (!stakeholderPatterns) return stakeholders;

    for (const [colName, value] of Object.entries(row)) {
      if (!value || value === "NA") continue;
      // SANITIZE the value
      const sanitizedValue = this.sanitizeExcelValue(value);
      const stakeholderType = this.matchColumn(colName, stakeholderPatterns);
      if (stakeholderType) {
        const names = this.splitMultipleNames(String(sanitizedValue));
        for (const name of names) {
          stakeholders.push({
            project_id: projectId,
            stakeholder_name: this.sanitizeExcelValue(name),
            stakeholder_type: stakeholderType
              .replace(/_/g, " ")
              .replace(/\b\w/g, (l) => l.toUpperCase()),
            company_name: stakeholderType === "construction_company" ? this.sanitizeExcelValue(name) : null,
            role_on_project: stakeholderType
              .replace(/_/g, " ")
              .replace(/\b\w/g, (l) => l.toUpperCase()),
            custom_fields: {},
          });
        }
      }
    }
    return stakeholders;
  }

  extractCustomFields(row, rawMappings) {
    const customFields = {};
    const mappedColumns = new Set(Object.values(rawMappings));
    for (const [colName, value] of Object.entries(row)) {
      if (value === undefined || value === null || value === "NA") continue;
      
      // SANITIZE the value
      const sanitizedValue = this.sanitizeExcelValue(value);
      
      if (!mappedColumns.has(colName)) {
        if (
          typeof sanitizedValue === "number" &&
          (colName.includes("Date") ||
            colName.includes("Start") ||
            colName.includes("Complete"))
        ) {
          const jsDate = this.excelDateToJSDate(sanitizedValue);
          customFields[colName] = jsDate
            ? jsDate.toISOString().split("T")[0]
            : sanitizedValue;
        } else {
          customFields[colName] = sanitizedValue;
        }
      }
    }
    return customFields;
  }

  async importExcel(
    filePath,
    clientId,
    selectedAssessTypeFromDropdown,
    selectedMappingName,
  ) {
    const results = {
      success: 0,
      failed: 0,
      errors: [],
      projects: [],
      contacts: [],
      stakeholders: [],
    };

    // Check out a dedicated connection for all transactions
    const dbClient = await this.pool.connect();

    try {
      const clientDefaults = await this.getClientDefaults(clientId);
      const validAssessTypes = await this.getValidAssessTypes(clientId);
      const mappingData = await this.loadMappingsFromDB(
        clientId,
        selectedMappingName,
      );

      if (!mappingData)
        throw new Error(
          `No mappings found for template "${selectedMappingName}".`,
        );
      const { mappings, rawMappings } = mappingData;

      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet);
      const hasAssessTypeColumn =
        rows[0] && rows[0]["AssessType"] !== undefined;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        try {
          await dbClient.query("BEGIN");

          let assessTypeToUse = selectedAssessTypeFromDropdown;
          if (
            hasAssessTypeColumn &&
            row["AssessType"] &&
            row["AssessType"].trim() !== ""
          ) {
            const excelAssessType = row["AssessType"].trim();
            if (validAssessTypes.includes(excelAssessType))
              assessTypeToUse = excelAssessType;
            else if (excelAssessType !== "")
              throw new Error(
                `Invalid AssessType "${excelAssessType}". Valid types: ${validAssessTypes.join(", ")}`,
              );
          }

          if (!assessTypeToUse || assessTypeToUse === "") {
            throw new Error(
              `No AssessType selected. Please select a valid AssessType.`,
            );
          }

          let projectName = null;
          let projectIdentifier = null;
          let projectType = null;
          let customerName = null;
          let contractorName = null;
          let contractorPhone = null;
          let contractorCompany = null;
          let address = null;
          let city = null;
          let state = null;
          let jobAddress = null;
          let jobCity = null;
          let jobState = null;

          for (const [colName, value] of Object.entries(row)) {
            if (value === undefined || value === null || value === "NA")
              continue;
            
            // SANITIZE the value
            const sanitizedValue = this.sanitizeExcelValue(value);

            if (
              mappings.project_name.length > 0 &&
              this.matchColumn(colName, { name: mappings.project_name })
            ) {
              projectName = String(sanitizedValue);
            } else if (
              mappings.project_id.length > 0 &&
              this.matchColumn(colName, { num: mappings.project_id })
            ) {
              projectIdentifier = String(sanitizedValue);
            } else if (
              mappings.address.length > 0 &&
              this.matchColumn(colName, { addr: mappings.address })
            ) {
              address = String(sanitizedValue);
            } else if (
              mappings.city.length > 0 &&
              this.matchColumn(colName, { city: mappings.city })
            ) {
              city = String(sanitizedValue);
            } else if (
              mappings.state.length > 0 &&
              this.matchColumn(colName, { state: mappings.state })
            ) {
              state = String(sanitizedValue);
            } else if (
              mappings.project_type.length > 0 &&
              this.matchColumn(colName, { type: mappings.project_type })
            ) {
              projectType = String(sanitizedValue);
            } else if (
              mappings.customer_name.length > 0 &&
              this.matchColumn(colName, { cust: mappings.customer_name })
            ) {
              customerName = String(sanitizedValue);
            } else if (
              mappings.contractor_name.length > 0 &&
              this.matchColumn(colName, {
                contractor: mappings.contractor_name,
              })
            ) {
              contractorName = String(sanitizedValue);
            } else if (
              mappings.contractor_phone.length > 0 &&
              this.matchColumn(colName, {
                contractor_phone: mappings.contractor_phone,
              })
            ) {
              contractorPhone = String(sanitizedValue);
            } else if (
              mappings.contractor_company.length > 0 &&
              this.matchColumn(colName, {
                contractor_company: mappings.contractor_company,
              })
            ) {
              contractorCompany = String(sanitizedValue);
            } else if (
              mappings.job_address.length > 0 &&
              this.matchColumn(colName, { job_addr: mappings.job_address })
            ) {
              jobAddress = String(sanitizedValue);
            } else if (
              mappings.job_city.length > 0 &&
              this.matchColumn(colName, { job_city: mappings.job_city })
            ) {
              jobCity = String(sanitizedValue);
            } else if (
              mappings.job_state.length > 0 &&
              this.matchColumn(colName, { job_state: mappings.job_state })
            ) {
              jobState = String(sanitizedValue);
            }
          }

          if (!projectName) {
            const firstValue = Object.values(row).find(
              (v) => v && typeof v === "string",
            );
            projectName = firstValue
              ? String(this.sanitizeExcelValue(firstValue)).substring(0, 100)
              : "Unknown Project";
          }

          const customFields = this.extractCustomFields(row, rawMappings);
          const custCountry = this.sanitizeExcelValue(
            row["Customer Country"] ||
            row["Cust_Country"] ||
            row["Country"] ||
            clientDefaults.cust_country
          );
          const jobCountry = this.sanitizeExcelValue(
            row["Job Country"] ||
            row["Job_Country"] ||
            row["Country"] ||
            clientDefaults.job_country
          );
          const extraInfo = this.sanitizeExcelValue(
            row["Extra Info"] || row["Notes"] || null
          );
          const uploadDate = new Date().toISOString().split("T")[0];

          const projectResult = await dbClient.query(
            `INSERT INTO projects (
              client_id, project_name, project_id, customer_name, project_type, 
              address, city, state, cust_country, job_country, 
              job_address, job_city, job_state,
              contractor_name, contractor_phone, contractor_company,
              assess_type, extra_info, upload_date, custom_fields
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING *`,
            [
              clientId,
              projectName,
              projectIdentifier,
              customerName,
              projectType,
              address,
              city,
              state,
              custCountry,
              jobCountry,
              jobAddress,
              jobCity,
              jobState,
              contractorName,
              contractorPhone,
              contractorCompany,
              assessTypeToUse,
              extraInfo,
              uploadDate,
              customFields,
            ],
          );

          const dbProjectId = projectResult.rows[0].id;
          results.projects.push(dbProjectId);

          const contacts = this.extractContacts(
            row,
            dbProjectId,
            mappings,
            rawMappings,
          );
          for (const contact of contacts) {
            contact.client_id = clientId;
            const contactResult = await dbClient.query(
              `INSERT INTO contacts (client_id, project_id, contact_name, role, phone, email, is_primary, custom_fields) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
              [
                contact.client_id,
                contact.project_id,
                contact.contact_name,
                contact.role,
                contact.phone,
                contact.email,
                contact.is_primary,
                contact.custom_fields,
              ],
            );
            results.contacts.push(contactResult.rows[0].id);
          }

          const stakeholders = this.extractStakeholders(
            row,
            dbProjectId,
            mappings,
          );
          for (const stakeholder of stakeholders) {
            stakeholder.client_id = clientId;
            const stakeholderResult = await dbClient.query(
              `INSERT INTO stakeholders (client_id, project_id, stakeholder_name, stakeholder_type, company_name, role_on_project, custom_fields) 
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
              [
                stakeholder.client_id,
                stakeholder.project_id,
                stakeholder.stakeholder_name,
                stakeholder.stakeholder_type,
                stakeholder.company_name,
                stakeholder.role_on_project,
                stakeholder.custom_fields,
              ],
            );
            results.stakeholders.push(stakeholderResult.rows[0].id);
          }

          await dbClient.query("COMMIT");
          results.success++;

          console.log(
            `✅ Row ${i + 1}: "${projectName}" - ${contacts.length} contacts, ${stakeholders.length} stakeholders`,
          );
        } catch (rowError) {
          await dbClient.query("ROLLBACK");
          results.failed++;
          results.errors.push({ row: i + 1, error: rowError.message });
          console.error(`❌ Row ${i + 1} failed:`, rowError.message);
        }
      }

      console.log(
        `\n📊 Import Summary: ${results.success} successful, ${results.failed} failed`,
      );
      return results;
    } catch (err) {
      throw err;
    } finally {
      // ALWAYS release the connection back to the pool
      dbClient.release();
    }
  }
}

module.exports = ExcelImporter;