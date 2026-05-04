require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const multer = require("multer");
const XLSX = require("xlsx");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fsPromises = require("fs").promises;
const ExcelImporter = require("./excelImporter");

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ================= DB CONNECTION =================
const isProduction = process.env.RENDER === "true" || !!process.env.RENDER;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

console.log(`Database SSL mode: ${isProduction ? "ON (Cloud)" : "OFF (Local)"}`);

pool.on("error", (err, client) => {
  console.error("Unexpected error on idle database client:", err);
});

pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ Error connecting to PostgreSQL:", err.message);
  } else {
    console.log("✅ Connected to PostgreSQL successfully");
    release();
  }
});

// ================= SECURE UPLOAD CONFIGURATIONS =================
const secureExcelUpload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (file.originalname.match(/\.(xlsx|xls)$/i)) {
      return cb(null, true);
    }
    cb(new Error("Only Excel files are allowed"));
  },
});

const logoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "public/uploads/logos");
    fs.mkdir(uploadDir, { recursive: true }, (err) => {
      if (err) return cb(err);
      cb(null, uploadDir);
    });
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, "logo-" + uniqueSuffix + ext);
  },
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|svg|webp/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error("Only image files are allowed"));
  },
});

// Utility to clean up string inputs
function sanitize(value) {
  return typeof value === "string" ? value.trim() : value;
}

// ================= UTILS =================
function validateRequired(fields, res) {
  for (const key in fields) {
    if (!fields[key]) {
      res.status(400).json({ error: `${key} is required` });
      return false;
    }
  }
  return true;
}

// ============ ASSESS TYPES CRUD & EXPORTS ============

app.get("/api/assess-types/all", async (req, res, next) => {
  try {
    const { showAll } = req.query;
    let query = `
            SELECT at.*, c.client_name 
            FROM assess_types at 
            LEFT JOIN clients c ON at.client_id = c.id
        `;
    if (showAll !== "true") query += " WHERE at.is_active = true";
    query += " ORDER BY at.assess_type";
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get("/api/assess-types/by-id/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM assess_types WHERE id = $1",
      [id],
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Assess type not found" });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.get("/api/assess-types/client/:clientId", async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const { showAll } = req.query;
    let query = "SELECT * FROM assess_types WHERE client_id = $1";
    if (showAll !== "true") query += " AND is_active = true";
    query += " ORDER BY is_default DESC, assess_type";
    const result = await pool.query(query, [clientId]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.post("/api/assess-types", async (req, res, next) => {
  const {
    client_id,
    assess_type,
    assess_full_name,
    name_on_report,
    assess_version,
    assess_type_description,
    is_default,
    created_by,
  } = req.body;
  if (!validateRequired({ client_id, assess_type }, res)) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (is_default) {
      await client.query(
        "UPDATE assess_types SET is_default = false WHERE client_id = $1",
        [client_id],
      );
    }
    const result = await client.query(
      `INSERT INTO assess_types (client_id, assess_type, assess_full_name, name_on_report, assess_version, assess_type_description, is_default, created_by) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        client_id,
        assess_type,
        assess_full_name,
        name_on_report,
        assess_version || 1,
        assess_type_description,
        is_default || false,
        created_by || "system",
      ],
    );
    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

app.put("/api/assess-types/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      client_id,
      assess_type,
      assess_full_name,
      name_on_report,
      assess_version,
      assess_type_description,
      is_active,
      is_default,
    } = req.body;

    let targetClientId = client_id;
    if (!targetClientId) {
      const clientResult = await pool.query(
        "SELECT client_id FROM assess_types WHERE id = $1",
        [id],
      );
      if (clientResult.rows.length === 0) {
        return res.status(404).json({ error: "Assess type not found" });
      }
      targetClientId = clientResult.rows[0].client_id;
    }

    if (is_default && targetClientId) {
      await pool.query(
        "UPDATE assess_types SET is_default = false WHERE client_id = $1 AND id != $2",
        [targetClientId, id],
      );
    }

    const result = await pool.query(
      `UPDATE assess_types SET 
        assess_type = $1, 
        assess_full_name = $2, 
        name_on_report = $3, 
        assess_version = $4, 
        assess_type_description = $5, 
        is_active = $6, 
        is_default = $7, 
        client_id = $8, 
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = $9 RETURNING *`,
      [
        assess_type,
        assess_full_name,
        name_on_report,
        assess_version,
        assess_type_description,
        is_active,
        is_default,
        targetClientId,
        id,
      ],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/assess-types/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM assess_types WHERE id = $1", [req.params.id]);
    res.json({ message: "Assess type deleted successfully" });
  } catch (err) {
    next(err);
  }
});

app.get("/api/assess-types/all/export", async (req, res, next) => {
  try {
    const { format, showAll } = req.query;
    let query = `SELECT at.assess_type, at.assess_full_name, at.name_on_report, at.assess_version, at.assess_type_description, at.is_default, at.is_active, at.created_at, c.client_name FROM assess_types at JOIN clients c ON at.client_id = c.id`;
    if (showAll !== "true") query += " WHERE at.is_active = true";
    query += " ORDER BY c.client_name, at.assess_type";
    const result = await pool.query(query);

    if (format === "csv") {
      const headers = [
        "Client Name",
        "Assess Type",
        "Full Name",
        "Report Name",
        "Version",
        "Description",
        "Is Default",
        "Is Active",
        "Created Date",
      ];
      const csvRows = [headers.join(",")];
      for (const at of result.rows) {
        csvRows.push(
          [
            `"${at.client_name}"`,
            `"${at.assess_type}"`,
            `"${at.assess_full_name || ""}"`,
            `"${at.name_on_report || ""}"`,
            at.assess_version,
            `"${at.assess_type_description || ""}"`,
            at.is_default ? "Yes" : "No",
            at.is_active ? "Yes" : "No",
            at.created_at,
          ].join(","),
        );
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=assess_types_all.csv`,
      );
      res.send(csvRows.join("\n"));
    } else {
      const worksheet = XLSX.utils.json_to_sheet(result.rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "All Assessment Types");
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=assess_types_all.xlsx`,
      );
      res.send(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
    }
  } catch (err) {
    next(err);
  }
});

app.get("/api/assess-types/export/client/:clientId", async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const { format, showAll } = req.query;
    let query =
      "SELECT at.assess_type, at.assess_full_name, at.name_on_report, at.assess_version, at.assess_type_description, at.is_default, at.is_active, at.created_at, c.client_name FROM assess_types at JOIN clients c ON at.client_id = c.id WHERE at.client_id = $1";
    if (showAll !== "true") query += " AND at.is_active = true";
    query += " ORDER BY at.assess_type";

    const result = await pool.query(query, [clientId]);

    if (format === "csv") {
      const headers = [
        "Client Name",
        "Assess Type",
        "Full Name",
        "Report Name",
        "Version",
        "Description",
        "Is Default",
        "Is Active",
        "Created Date",
      ];
      const csvRows = [headers.join(",")];
      for (const at of result.rows) {
        csvRows.push(
          [
            `"${at.client_name}"`,
            `"${at.assess_type}"`,
            `"${at.assess_full_name || ""}"`,
            `"${at.name_on_report || ""}"`,
            at.assess_version,
            `"${at.assess_type_description || ""}"`,
            at.is_default ? "Yes" : "No",
            at.is_active ? "Yes" : "No",
            at.created_at,
          ].join(","),
        );
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=assess_types_client_${clientId}.csv`,
      );
      res.send(csvRows.join("\n"));
    } else {
      const worksheet = XLSX.utils.json_to_sheet(result.rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Assessment Types");
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=assess_types_client_${clientId}.xlsx`,
      );
      res.send(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
    }
  } catch (err) {
    next(err);
  }
});

// ============ CLIENTS CRUD & EXPORTS ============

app.get("/api/clients", async (req, res, next) => {
  try {
    const { showAll } = req.query;
    let query = "SELECT * FROM clients ORDER BY client_name";
    if (showAll !== "true")
      query =
        "SELECT * FROM clients WHERE is_active = true ORDER BY client_name";
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get("/api/clients/export", async (req, res, next) => {
  try {
    const { format, showAll } = req.query;
    let query =
      "SELECT id, client_name, client_abbreviation, industry, contact_person, contact_email, contact_phone, is_active, default_cust_country, default_job_country, created_at FROM clients ORDER BY client_name";
    if (showAll !== "true")
      query =
        "SELECT id, client_name, client_abbreviation, industry, contact_person, contact_email, contact_phone, is_active, default_cust_country, default_job_country, created_at FROM clients WHERE is_active = true ORDER BY client_name";

    const result = await pool.query(query);
    const clients = result.rows;

    if (format === "csv") {
      const headers = [
        "ID",
        "Client Name",
        "Abbreviation",
        "Industry",
        "Contact Person",
        "Contact Email",
        "Contact Phone",
        "Active",
        "Default Customer Country",
        "Default Job Country",
        "Created Date",
      ];
      const csvRows = [headers.join(",")];
      for (const client of clients) {
        csvRows.push(
          [
            client.id,
            `"${(client.client_name || "").replace(/"/g, '""')}"`,
            `"${(client.client_abbreviation || "").replace(/"/g, '""')}"`,
            `"${(client.industry || "").replace(/"/g, '""')}"`,
            `"${(client.contact_person || "").replace(/"/g, '""')}"`,
            `"${(client.contact_email || "").replace(/"/g, '""')}"`,
            `"${(client.contact_phone || "").replace(/"/g, '""')}"`,
            client.is_active ? "Yes" : "No",
            `"${(client.default_cust_country || "Canada").replace(/"/g, '""')}"`,
            `"${(client.default_job_country || "Canada").replace(/"/g, '""')}"`,
            client.created_at
              ? new Date(client.created_at).toLocaleDateString()
              : "",
          ].join(","),
        );
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=clients.csv`);
      res.send(csvRows.join("\n"));
    } else {
      const worksheet = XLSX.utils.json_to_sheet(clients);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Clients");
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", `attachment; filename=clients.xlsx`);
      res.send(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
    }
  } catch (err) {
    next(err);
  }
});

app.get("/api/clients/:id", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM clients WHERE id = $1", [
      req.params.id,
    ]);
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Client not found" });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.post("/api/clients", async (req, res, next) => {
  const client_name = sanitize(req.body.client_name);
  const client_abbreviation = sanitize(req.body.client_abbreviation);
  const industry = sanitize(req.body.industry);
  const contact_person = sanitize(req.body.contact_person);

  const {
    client_logo,
    contact_email,
    contact_phone,
    is_active,
    default_cust_country,
    default_job_country,
  } = req.body;

  if (!validateRequired({ client_name }, res)) return;

  try {
    const exists = await pool.query(
      "SELECT id FROM clients WHERE client_name = $1",
      [client_name],
    );
    if (exists.rows.length)
      return res
        .status(400)
        .json({ error: "A client with this name already exists" });

    const result = await pool.query(
      `INSERT INTO clients (client_name, client_abbreviation, client_logo, industry, contact_person, contact_email, contact_phone, is_active, default_cust_country, default_job_country) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        client_name,
        client_abbreviation,
        client_logo,
        industry,
        contact_person,
        contact_email,
        contact_phone,
        is_active !== undefined ? is_active : true,
        default_cust_country || "Canada",
        default_job_country || "Canada",
      ],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.put("/api/clients/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const client_name = sanitize(req.body.client_name);
    const client_abbreviation = sanitize(req.body.client_abbreviation);
    const industry = sanitize(req.body.industry);
    const contact_person = sanitize(req.body.contact_person);

    const {
      client_logo,
      contact_email,
      contact_phone,
      is_active,
      default_cust_country,
      default_job_country,
    } = req.body;

    let logoToSave = client_logo;
    if (logoToSave === undefined || logoToSave === null) {
      const existing = await pool.query(
        "SELECT client_logo FROM clients WHERE id = $1",
        [id],
      );
      logoToSave = existing.rows[0]?.client_logo;
    }

    const result = await pool.query(
      `UPDATE clients SET client_name = $1, client_abbreviation = $2, client_logo = $3, industry = $4, contact_person = $5, contact_email = $6, contact_phone = $7, is_active = $8, default_cust_country = $9, default_job_country = $10, updated_at = CURRENT_TIMESTAMP WHERE id = $11 RETURNING *`,
      [
        client_name,
        client_abbreviation,
        logoToSave,
        industry,
        contact_person,
        contact_email,
        contact_phone,
        is_active,
        default_cust_country || "Canada",
        default_job_country || "Canada",
        id,
      ],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/clients/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const projects = await pool.query(
      "SELECT id FROM projects WHERE client_id = $1 LIMIT 1",
      [id],
    );
    if (projects.rows.length > 0)
      return res
        .status(400)
        .json({ error: "Cannot delete client with existing projects." });
    await pool.query("DELETE FROM clients WHERE id = $1 RETURNING id", [id]);
    res.json({ message: "Client deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// ============ LOGO UPLOAD & DELETE ============

app.post(
  "/api/clients/:id/logo",
  uploadLogo.single("logo"),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const logoPath = `/uploads/logos/${req.file.filename}`;
      const oldClient = await pool.query(
        "SELECT client_logo FROM clients WHERE id = $1",
        [id],
      );
      if (oldClient.rows[0]?.client_logo) {
        const oldLogoPath = path.join(
          __dirname,
          "public",
          oldClient.rows[0].client_logo,
        );
        try {
          await fsPromises.access(oldLogoPath);
          await fsPromises.unlink(oldLogoPath);
        } catch (e) {}
      }

      const result = await pool.query(
        "UPDATE clients SET client_logo = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
        [logoPath, id],
      );
      res.json({
        message: "Logo uploaded successfully",
        logoPath: logoPath,
        client: result.rows[0],
      });
    } catch (err) {
      next(err);
    }
  },
);

app.delete("/api/clients/:id/logo", async (req, res, next) => {
  try {
    const { id } = req.params;
    const client = await pool.query(
      "SELECT client_logo FROM clients WHERE id = $1",
      [id],
    );
    if (client.rows[0]?.client_logo) {
      const logoPath = path.join(
        __dirname,
        "public",
        client.rows[0].client_logo,
      );
      try {
        await fsPromises.access(logoPath);
        await fsPromises.unlink(logoPath);
      } catch (e) {}
      await pool.query(
        "UPDATE clients SET client_logo = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [id],
      );
    }
    res.json({ message: "Logo removed successfully" });
  } catch (err) {
    next(err);
  }
});

// ============ PROJECTS CRUD ============

app.get("/api/clients/:clientId/projects", async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const result = await pool.query(
      `SELECT p.*, s.is_interviewed, s.assessment_date, s.is_abandoned, s.abandon_reason
       FROM projects p
       LEFT JOIN project_interview_status s ON p.id = s.project_id
       WHERE p.client_id = $1
       ORDER BY p.ci_number DESC`,
      [clientId],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get("/api/projects/:projectId", async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const projectResult = await pool.query(
      "SELECT * FROM projects WHERE id = $1",
      [projectId],
    );
    if (projectResult.rows.length === 0)
      return res.status(404).json({ error: "Project not found" });
    const contactsResult = await pool.query(
      "SELECT * FROM contacts WHERE project_id = $1",
      [projectId],
    );
    const stakeholdersResult = await pool.query(
      "SELECT * FROM stakeholders WHERE project_id = $1",
      [projectId],
    );
    res.json({
      project: projectResult.rows[0],
      contacts: contactsResult.rows,
      stakeholders: stakeholdersResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/projects", async (req, res, next) => {
  try {
    const {
      client_id,
      project_name,
      project_id,
      customer_name,
      project_type,
      address,
      city,
      state,
      job_address,
      job_city,
      job_state,
      cust_country,
      job_country,
      project_stage,
      assess_type,
      extra_info,
      ci_note,
      contractor_name,
      contractor_phone,
      contractor_company,
      upload_date,
      custom_fields,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO projects (
        client_id, project_name, project_id, customer_name, project_type,
        address, city, state, job_address, job_city, job_state,
        cust_country, job_country, project_stage, assess_type,
        extra_info, ci_note, contractor_name, contractor_phone, contractor_company,
        upload_date, custom_fields
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING *`,
      [
        client_id,
        project_name,
        project_id,
        customer_name,
        project_type,
        address,
        city,
        state,
        job_address,
        job_city,
        job_state,
        cust_country || "Canada",
        job_country || "Canada",
        project_stage,
        assess_type,
        extra_info,
        ci_note,
        contractor_name,
        contractor_phone,
        contractor_company,
        upload_date,
        custom_fields || {},
      ],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.put("/api/projects/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      project_name,
      project_id,
      customer_name,
      project_type,
      address,
      city,
      state,
      job_address,
      job_city,
      job_state,
      cust_country,
      job_country,
      project_stage,
      assess_type,
      extra_info,
      ci_note,
      contractor_name,
      contractor_phone,
      contractor_company,
      upload_date,
      custom_fields,
    } = req.body;

    const result = await pool.query(
      `UPDATE projects SET
        project_name = $1,
        project_id = $2,
        customer_name = $3,
        project_type = $4,
        address = $5,
        city = $6,
        state = $7,
        job_address = $8,
        job_city = $9,
        job_state = $10,
        cust_country = $11,
        job_country = $12,
        project_stage = $13,
        assess_type = $14,
        extra_info = $15,
        ci_note = $16,
        contractor_name = $17,
        contractor_phone = $18,
        contractor_company = $19,
        upload_date = $20,
        custom_fields = $21,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $22 RETURNING *`,
      [
        project_name,
        project_id,
        customer_name,
        project_type,
        address,
        city,
        state,
        job_address,
        job_city,
        job_state,
        cust_country,
        job_country,
        project_stage,
        assess_type,
        extra_info,
        ci_note,
        contractor_name,
        contractor_phone,
        contractor_company,
        upload_date,
        custom_fields || {},
        id,
      ],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/projects/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM projects WHERE id = $1", [req.params.id]);
    res.json({ message: "Project deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// ============ CONTACTS & STAKEHOLDERS ============

app.post("/api/contacts", async (req, res, next) => {
  try {
    const {
      client_id,
      project_id,
      contact_name,
      role,
      phone,
      email,
      is_primary,
    } = req.body;
    const result = await pool.query(
      `INSERT INTO contacts (client_id, project_id, contact_name, role, phone, email, is_primary) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        client_id,
        project_id,
        contact_name,
        role,
        phone,
        email,
        is_primary || false,
      ],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/contacts/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM contacts WHERE id = $1", [req.params.id]);
    res.json({ message: "Contact deleted" });
  } catch (err) {
    next(err);
  }
});

app.post("/api/stakeholders", async (req, res, next) => {
  try {
    const {
      client_id,
      project_id,
      stakeholder_name,
      stakeholder_type,
      company_name,
      role_on_project,
    } = req.body;
    const result = await pool.query(
      `INSERT INTO stakeholders (client_id, project_id, stakeholder_name, stakeholder_type, company_name, role_on_project) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        client_id,
        project_id,
        stakeholder_name,
        stakeholder_type,
        company_name,
        role_on_project,
      ],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/stakeholders/:id", async (req, res, next) => {
  try {
    await pool.query("DELETE FROM stakeholders WHERE id = $1", [req.params.id]);
    res.json({ message: "Stakeholder deleted" });
  } catch (err) {
    next(err);
  }
});

// ============ EXCEL UPLOAD ROUTES ============

app.post(
  "/api/upload/:clientId",
  secureExcelUpload.single("excel"),
  async (req, res, next) => {
    try {
      const { clientId } = req.params;
      const { assessType, mappingName } = req.query;
      const filePath = req.file.path;

      console.log(
        `📄 Starting import for client ${clientId} from file: ${req.file.originalname}`,
      );
      console.log(`📋 Selected Mapping: ${mappingName || "Not provided"}`);

      const importer = new ExcelImporter(pool);
      const results = await importer.importExcel(
        filePath,
        parseInt(clientId),
        assessType,
        mappingName,
      );

      res.json({
        message: `Import completed. ${results.success} rows succeeded, ${results.failed} failed.`,
        summary: {
          success: results.success,
          failed: results.failed,
          projects_created: results.projects.length,
          contacts_created: results.contacts.length,
          stakeholders_created: results.stakeholders.length,
        },
        errors: results.errors.length > 0 ? results.errors : undefined,
      });
    } catch (err) {
      console.error("❌ Import error:", err);
      res.status(500).json({ error: err.message });
    } finally {
      if (req.file && req.file.path) {
        try {
          await fsPromises.unlink(req.file.path);
        } catch (e) {}
      }
    }
  },
);

app.post(
  "/api/get-excel-columns",
  secureExcelUpload.single("excel"),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet);

      if (rows.length === 0)
        return res.status(400).json({ error: "Excel file is empty" });

      const columns = Object.keys(rows[0]);
      const sampleData = {};
      columns.forEach((col) => {
        for (let i = 0; i < rows.length; i++) {
          const value = rows[i][col];
          if (
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ""
          ) {
            sampleData[col] =
              String(value).length > 50
                ? String(value).substring(0, 50) + "..."
                : String(value);
            break;
          }
        }
        if (!sampleData[col]) {
          sampleData[col] = "—";
        }
      });

      res.json({ columns, rowCount: rows.length, sampleData });
    } catch (err) {
      console.error("Error reading Excel:", err);
      res.status(500).json({ error: err.message });
    } finally {
      if (req.file && req.file.path) {
        try {
          await fsPromises.unlink(req.file.path);
        } catch (e) {}
      }
    }
  },
);

// ============ FIELD MAPPINGS CRUD & EXPORTS ============

app.get("/api/mapping-definitions", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT target_field, display_name, category FROM mapping_definitions ORDER BY sort_order",
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get("/api/column-mappings/:clientId", async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const { mappingName } = req.query;
    let query = "SELECT * FROM column_mappings WHERE client_id = $1";
    const params = [clientId];
    if (mappingName) {
      query += " AND mapping_name = $2";
      params.push(mappingName);
    }
    query += " ORDER BY excel_column";
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.get("/api/column-mappings/:clientId/names", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT mapping_name, is_active FROM column_mappings WHERE client_id = $1 ORDER BY mapping_name",
      [req.params.clientId],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

app.post("/api/column-mappings", async (req, res, next) => {
  const { client_id, mapping_name, mappings, created_by } = req.body;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM column_mappings WHERE client_id = $1 AND mapping_name = $2",
      [client_id, mapping_name],
    );

    if (mappings && mappings.length > 0) {
      for (const mapping of mappings) {
        await client.query(
          `INSERT INTO column_mappings (client_id, mapping_name, excel_column, target_field, is_custom_field, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            client_id,
            mapping_name,
            mapping.excel_column,
            mapping.target_field,
            mapping.is_custom_field || false,
            created_by || "admin",
          ],
        );
      }
    }
    await client.query("COMMIT");
    res.status(200).json({
      message: "Mappings saved successfully",
      count: mappings ? mappings.length : 0,
    });
  } catch (transactionErr) {
    await client.query("ROLLBACK");
    next(transactionErr);
  } finally {
    client.release();
  }
});

app.delete(
  "/api/column-mappings/:clientId/:mappingName",
  async (req, res, next) => {
    try {
      const { clientId, mappingName } = req.params;
      await pool.query(
        "DELETE FROM column_mappings WHERE client_id = $1 AND mapping_name = $2",
        [clientId, mappingName],
      );
      res.json({ message: "Mapping deleted successfully" });
    } catch (err) {
      next(err);
    }
  },
);

app.get("/api/column-mappings/:clientId/export", async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const { format, mappingName } = req.query;
    let query = `SELECT cm.excel_column, cm.target_field, cm.is_custom_field, cm.mapping_name, cm.created_at, md.display_name FROM column_mappings cm LEFT JOIN mapping_definitions md ON cm.target_field = md.target_field WHERE cm.client_id = $1`;
    const params = [clientId];
    if (mappingName) {
      query += " AND cm.mapping_name = $2";
      params.push(mappingName);
    }
    query += " ORDER BY cm.mapping_name, cm.excel_column";

    const result = await pool.query(query, params);

    if (format === "csv") {
      const headers = [
        "Mapping Name",
        "Excel Column",
        "Target Field",
        "Display Name",
        "Is Custom Field",
        "Created Date",
      ];
      const csvRows = [headers.join(",")];
      for (const m of result.rows) {
        csvRows.push(
          [
            `"${m.mapping_name || ""}"`,
            `"${m.excel_column || ""}"`,
            `"${m.target_field || ""}"`,
            `"${m.display_name || m.target_field || ""}"`,
            m.is_custom_field ? "Yes" : "No",
            m.created_at,
          ].join(","),
        );
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=mappings_client_${clientId}.csv`,
      );
      res.send(csvRows.join("\n"));
    } else {
      const worksheet = XLSX.utils.json_to_sheet(result.rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Mappings");
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=mappings_client_${clientId}.xlsx`,
      );
      res.send(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
    }
  } catch (err) {
    next(err);
  }
});

// ============ PROJECT INTERVIEW STATUS ENDPOINTS ============

app.get("/api/projects/:projectId/status", async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const result = await pool.query(
      "SELECT * FROM project_interview_status WHERE project_id = $1",
      [projectId],
    );
    if (result.rows.length === 0) {
      return res.json({
        project_id: parseInt(projectId),
        is_interviewed: false,
        is_requested: false,
        is_started: false,
        is_completed: false,
        is_abandoned: false,
        is_report_sent: false,
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

app.post("/api/projects/:projectId/status", async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const {
      hold_until_date,
      hold_reason,
      is_interviewed,
      assessment_date,
      is_requested,
      is_started,
      is_completed,
      is_abandoned,
      is_report_sent,
      abandoned_date,
      abandon_reason,
      abandon_comment,
      requested_date,
      started_date,
      completed_date,
      report_sent_date,
      writeup_date,
      interviewer_name,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO project_interview_status (
        project_id, hold_until_date, hold_reason, is_interviewed, assessment_date,
        is_requested, is_started, is_completed, is_abandoned, is_report_sent,
        abandoned_date, abandon_reason, abandon_comment, requested_date, started_date,
        completed_date, report_sent_date, writeup_date, interviewer_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      ON CONFLICT (project_id) DO UPDATE SET
        hold_until_date = EXCLUDED.hold_until_date,
        hold_reason = EXCLUDED.hold_reason,
        is_interviewed = EXCLUDED.is_interviewed,
        assessment_date = EXCLUDED.assessment_date,
        is_requested = EXCLUDED.is_requested,
        is_started = EXCLUDED.is_started,
        is_completed = EXCLUDED.is_completed,
        is_abandoned = EXCLUDED.is_abandoned,
        is_report_sent = EXCLUDED.is_report_sent,
        abandoned_date = EXCLUDED.abandoned_date,
        abandon_reason = EXCLUDED.abandon_reason,
        abandon_comment = EXCLUDED.abandon_comment,
        requested_date = EXCLUDED.requested_date,
        started_date = EXCLUDED.started_date,
        completed_date = EXCLUDED.completed_date,
        report_sent_date = EXCLUDED.report_sent_date,
        writeup_date = EXCLUDED.writeup_date,
        interviewer_name = EXCLUDED.interviewer_name,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        projectId,
        hold_until_date,
        hold_reason,
        is_interviewed,
        assessment_date,
        is_requested,
        is_started,
        is_completed,
        is_abandoned,
        is_report_sent,
        abandoned_date,
        abandon_reason,
        abandon_comment,
        requested_date,
        started_date,
        completed_date,
        report_sent_date,
        writeup_date,
        interviewer_name,
      ],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Global Error Handler - MUST be the last middleware
app.use((err, req, res, next) => {
  console.error("🔥 GLOBAL ERROR:", err.stack || err.message);
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
  });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Admin Control Hub running on port ${PORT}`);
});