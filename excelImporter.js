// excelImporter.js - FULLY MIGRATED TO CLIENT_ID
const XLSX = require("xlsx");

class ExcelImporter {
  constructor(pool) {
    this.pool = pool;
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
      const contactType = this.matchColumn(colName, contactPatterns);
      if (contactType) {
        const parts = contactType.split("_");
        const field = parts.length > 1 ? parts[1] : parts[0];
        contactData[field] = value;
      }
    }

    if (contactData.name || contactData.phone || contactData.email) {
      contacts.push({
        project_id: projectId,
        contact_name: contactData.name || "Unknown",
        role: contactData.role || contactData.title || "Contact",
        phone: contactData.phone || null,
        email: contactData.email || null,
        is_primary: true,
        custom_fields: {
          title: contactData.title || null,
          project_role: contactData.role || null,
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
      const stakeholderType = this.matchColumn(colName, stakeholderPatterns);
      if (stakeholderType) {
        const names = this.splitMultipleNames(String(value));
        for (const name of names) {
          stakeholders.push({
            project_id: projectId,
            stakeholder_name: name,
            stakeholder_type: stakeholderType
              .replace(/_/g, " ")
              .replace(/\b\w/g, (l) => l.toUpperCase()),
            company_name:
              stakeholderType === "construction_company" ? name : null,
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
      if (!mappedColumns.has(colName)) {
        if (
          typeof value === "number" &&
          (colName.includes("Date") ||
            colName.includes("Start") ||
            colName.includes("Complete"))
        ) {
          const jsDate = this.excelDateToJSDate(value);
          customFields[colName] = jsDate
            ? jsDate.toISOString().split("T")[0]
            : value;
        } else {
          customFields[colName] = value;
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

    try {
      // UPDATED: Removed the lookup for client_code completely
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
          await this.pool.query("BEGIN");

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

          // Declare all variables for project fields
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

          // Apply project field mappings
          for (const [colName, value] of Object.entries(row)) {
            if (value === undefined || value === null || value === "NA")
              continue;

            if (
              mappings.project_name.length > 0 &&
              this.matchColumn(colName, { name: mappings.project_name })
            ) {
              projectName = String(value);
            } else if (
              mappings.project_id.length > 0 &&
              this.matchColumn(colName, { num: mappings.project_id })
            ) {
              projectIdentifier = String(value);
            } else if (
              mappings.address.length > 0 &&
              this.matchColumn(colName, { addr: mappings.address })
            ) {
              address = String(value);
            } else if (
              mappings.city.length > 0 &&
              this.matchColumn(colName, { city: mappings.city })
            ) {
              city = String(value);
            } else if (
              mappings.state.length > 0 &&
              this.matchColumn(colName, { state: mappings.state })
            ) {
              state = String(value);
            } else if (
              mappings.project_type.length > 0 &&
              this.matchColumn(colName, { type: mappings.project_type })
            ) {
              projectType = String(value);
            } else if (
              mappings.customer_name.length > 0 &&
              this.matchColumn(colName, { cust: mappings.customer_name })
            ) {
              customerName = String(value);
            } else if (
              mappings.contractor_name.length > 0 &&
              this.matchColumn(colName, {
                contractor: mappings.contractor_name,
              })
            ) {
              contractorName = String(value);
            } else if (
              mappings.contractor_phone.length > 0 &&
              this.matchColumn(colName, {
                contractor_phone: mappings.contractor_phone,
              })
            ) {
              contractorPhone = String(value);
            } else if (
              mappings.contractor_company.length > 0 &&
              this.matchColumn(colName, {
                contractor_company: mappings.contractor_company,
              })
            ) {
              contractorCompany = String(value);
            } else if (
              mappings.job_address.length > 0 &&
              this.matchColumn(colName, { job_addr: mappings.job_address })
            ) {
              jobAddress = String(value);
            } else if (
              mappings.job_city.length > 0 &&
              this.matchColumn(colName, { job_city: mappings.job_city })
            ) {
              jobCity = String(value);
            } else if (
              mappings.job_state.length > 0 &&
              this.matchColumn(colName, { job_state: mappings.job_state })
            ) {
              jobState = String(value);
            }
          }

          if (!projectName) {
            const firstValue = Object.values(row).find(
              (v) => v && typeof v === "string",
            );
            projectName = firstValue
              ? String(firstValue).substring(0, 100)
              : "Unknown Project";
          }

          const customFields = this.extractCustomFields(row, rawMappings);
          const custCountry =
            row["Customer Country"] ||
            row["Cust_Country"] ||
            row["Country"] ||
            clientDefaults.cust_country;
          const jobCountry =
            row["Job Country"] ||
            row["Job_Country"] ||
            row["Country"] ||
            clientDefaults.job_country;
          const extraInfo = row["Extra Info"] || row["Notes"] || null;
          const uploadDate = new Date().toISOString().split("T")[0];

          // Complete INSERT statement with all fields
          const projectResult = await this.pool.query(
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
            const contactResult = await this.pool.query(
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
            const stakeholderResult = await this.pool.query(
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

          await this.pool.query("COMMIT");
          results.success++;

          console.log(
            `✅ Row ${i + 1}: "${projectName}" - ${contacts.length} contacts, ${stakeholders.length} stakeholders`,
          );
        } catch (rowError) {
          await this.pool.query("ROLLBACK");
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
    }
  }
}

module.exports = ExcelImporter;
