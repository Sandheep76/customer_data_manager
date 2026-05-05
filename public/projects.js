// ==================== PROJECTS MANAGEMENT ====================

async function loadClientDropdown() {
  try {
    const response = await fetch("/api/clients");
    const clients = await response.json();
    const select = document.getElementById("clientSelect");
    const showBtn = document.getElementById("showProjectsBtn");
    const newBtn = document.getElementById("newProjectBtn");
    select.innerHTML =
      '<option value="">-- Select a Client --</option>' +
      clients.map((c) => `<option value="${c.id}">${escapeHtml(c.client_name)}</option>`).join("");
    if (currentClientId) select.value = currentClientId;
    const updateButtons = () => {
      const hasClient = select.value !== "";
      if (showBtn) hasClient ? showBtn.removeAttribute("disabled") : showBtn.setAttribute("disabled", "true");
      if (newBtn) hasClient ? newBtn.removeAttribute("disabled") : newBtn.setAttribute("disabled", "true");
    };
    updateButtons();
    select.onchange = () => {
      currentClientId = select.value;
      document.getElementById("projectsListContainer").classList.add("hidden");
      updateButtons();
      if (currentClientId) {
        if (window.loadAssessTypesForProject) window.loadAssessTypesForProject();
        if (window.loadProjectMappingTemplates) window.loadProjectMappingTemplates();
      }
      if (window.checkUploadButtonState) window.checkUploadButtonState();
    };
    // FIX: If client is pre-selected, load mapping templates immediately
    if (currentClientId) {
      await loadProjectMappingTemplates();
      await loadAssessTypesForProject();
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadAssessTypesForProject() {
  const clientId = currentClientId;
  const select = document.getElementById("assessTypeSelect");
  if (!clientId) {
    select.innerHTML = '<option value="">-- Assess Type --</option>';
    return;
  }
  try {
    const response = await fetch(`/api/assess-types/client/${clientId}`);
    const assessTypes = await response.json();
    if (assessTypes.length === 0) select.innerHTML = '<option value="">-- No Types Available --</option>';
    else
      select.innerHTML =
        '<option value="">-- Assess Type --</option>' +
        assessTypes.map((at) => `<option value="${at.assess_type}">${escapeHtml(at.assess_type)}</option>`).join("");
  } catch (err) {
    console.error(err);
  }
}

async function loadProjectMappingTemplates() {
  const select = document.getElementById("clientSelect");
  const clientId = select.value;
  const templateSelect = document.getElementById("mappingTemplateSelect");
  if (!clientId) {
    templateSelect.innerHTML = '<option value="">-- Mapping Template --</option>';
    return;
  }
  try {
    const response = await fetch(`/api/column-mappings/${clientId}/names`);
    const mappings = await response.json();
    if (mappings.length === 0) templateSelect.innerHTML = '<option value="">-- No Mapping Templates Available --</option>';
    else
      templateSelect.innerHTML =
        '<option value="">-- Mapping Template --</option>' +
        mappings.map((m) => `<option value="${escapeHtml(m.mapping_name)}">${escapeHtml(m.mapping_name)}</option>`).join("");
  } catch (err) {
    console.error(err);
  }
}

function checkUploadButtonState() {
  const uploadBtn = document.getElementById("uploadExcelBtn");
  if (uploadBtn) uploadBtn.disabled = !currentClientId;
}

function validateUploadPrerequisites() {
  const mappingTemplate = document.getElementById("mappingTemplateSelect").value;
  const templateSelect = document.getElementById("mappingTemplateSelect");
  if (!mappingTemplate) {
    if (templateSelect.options.length <= 1) showToast("Create and select a mapping template.", "error");
    else showToast("Select a mapping template for loading the project.", "error");
    return;
  }
  document.getElementById("excelFile").click();
}

async function uploadExcel() {
  const fileInput = document.getElementById("excelFile");
  const file = fileInput.files[0];
  if (!file) return;
  const clientId = document.getElementById("clientSelect").value;
  if (!clientId) {
    showToast("Please select a client first", "error");
    fileInput.value = "";
    return;
  }
  const mappingName = document.getElementById("mappingTemplateSelect").value;
  if (!mappingName) {
    showToast("Please select a mapping template first", "error");
    fileInput.value = "";
    return;
  }
  const formData = new FormData();
  formData.append("excel", file);
  const uploadStatus = document.getElementById("uploadStatus");
  uploadStatus.innerHTML = "<p>📤 Uploading and importing...</p>";
  try {
    const response = await fetch(`/api/upload/${clientId}?assessType=auto&mappingName=${encodeURIComponent(mappingName)}`, {
      method: "POST",
      body: formData,
    });
    const result = await response.json();
    if (response.ok) {
      uploadStatus.innerHTML = `<p class="status-success">✅ ${escapeHtml(result.message)}</p>`;
      if (result.summary)
        uploadStatus.innerHTML += `<p class="status-success">Projects: ${result.summary.projects_created}, Contacts: ${result.summary.contacts_created}, Stakeholders: ${result.summary.stakeholders_created}</p>`;
      clearStatusMessage("uploadStatus");
      loadProjects();
    } else uploadStatus.innerHTML = `<p class="status-error">❌ Error: ${escapeHtml(result.error)}</p>`;
  } catch (err) {
    uploadStatus.innerHTML = `<p class="status-error">❌ Upload failed: ${escapeHtml(err.message)}</p>`;
  }
  fileInput.value = "";
}

async function loadProjects() {
  currentClientId = document.getElementById("clientSelect").value;
  const listContainer = document.getElementById("projectsListContainer");
  if (!currentClientId) {
    showToast("Please select a client first", "error");
    listContainer.classList.add("hidden");
    return;
  }
  try {
    const response = await fetch(`/api/clients/${currentClientId}/projects`);
    const projects = await response.json();
    allProjects = projects;
    if (allProjects.length === 0) {
      listContainer.classList.add("hidden");
      showToast("No projects found for this client.", "info");
      return;
    }
    listContainer.classList.remove("hidden");
    currentPage = 1;
    totalPages = Math.ceil(allProjects.length / itemsPerPage);
    renderProjectsPage();
    renderPagination();
  } catch (err) {
    showToast("Error loading projects: " + err.message, "error");
  }
}

function renderProjectsPage() {
  const tbody = document.getElementById("projectsBody");
  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const pageProjects = allProjects.slice(start, end);
  if (pageProjects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 30px; color: #666;">No projects found.</td></tr>';
    return;
  }
  tbody.innerHTML = pageProjects
    .map(
      (p) => `<tr ondblclick="editProject(${p.id})" style="cursor: pointer;">
    <td style="text-align: center;"><input type="checkbox" class="project-select-cb" value="${p.id}" onclick="event.stopPropagation()"></td>
    <td class="ci-number">${p.ci_number || "-"}</td>
    <td>${escapeHtml(p.customer_name) || "-"}</td>
    <td>${escapeHtml(p.assess_type) || "-"}</td>
    <td>${escapeHtml(p.cust_country) || "-"}</td>
    <td>${escapeHtml(p.project_stage) || "-"}</td>
    <td>${new Date(p.created_at).toLocaleDateString()}</td>
    <td style="text-align: right;"></td>
  </tr>`,
    )
    .join("");
}

function renderPagination() {
  const container = document.getElementById("paginationControls");
  const infoContainer = document.getElementById("paginationInfo");
  if (totalPages <= 1) {
    container.classList.add("hidden");
    infoContainer.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  infoContainer.classList.remove("hidden");
  let html = `<button onclick="changePage(1)" ${currentPage === 1 ? "disabled" : ""}>First</button>`;
  html += `<button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}>Previous</button>`;
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, currentPage + 2);
  if (startPage > 1) html += `<button onclick="changePage(${startPage - 1})">...</button>`;
  for (let i = startPage; i <= endPage; i++) html += `<button onclick="changePage(${i})" class="${i === currentPage ? "active" : ""}">${i}</button>`;
  if (endPage < totalPages) html += `<button onclick="changePage(${endPage + 1})">...</button>`;
  html += `<button onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? "disabled" : ""}>Next</button>`;
  html += `<button onclick="changePage(${totalPages})" ${currentPage === totalPages ? "disabled" : ""}>Last</button>`;
  container.innerHTML = html;
  infoContainer.innerHTML = `Showing ${(currentPage - 1) * itemsPerPage + 1} to ${Math.min(currentPage * itemsPerPage, allProjects.length)} of ${allProjects.length} projects`;
}

function changePage(page) {
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderProjectsPage();
  renderPagination();
}

function showAddProjectModal() {
  if (!currentClientId && document.getElementById("clientSelect").value) currentClientId = document.getElementById("clientSelect").value;
  if (!currentClientId) {
    showToast("Please select a client first", "error");
    return;
  }
  document.getElementById("projectModalTitle").textContent = "Add Project";
  document.getElementById("projectForm").reset();
  document.getElementById("projectId").value = "";
  document.getElementById("projectCiNumber").value = "Auto-generated";
  document.getElementById("projectCustCountry").value = "Canada";
  document.getElementById("projectJobCountry").value = "Canada";
  document.getElementById("uploadDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("copyProjectBtnModal").style.display = "none";
  document.getElementById("projectModal").style.display = "block";
  loadProjectAssessTypes();
}

async function loadProjectAssessTypes() {
  if (!currentClientId) return;
  try {
    const response = await fetch(`/api/assess-types/client/${currentClientId}`);
    const assessTypes = await response.json();
    const select = document.getElementById("projectAssessType");
    if (assessTypes.length === 0) select.innerHTML = '<option value="">-- No Assessment Types Available --</option>';
    else
      select.innerHTML =
        '<option value="">-- Select Assessment Type --</option>' +
        assessTypes.map((at) => `<option value="${at.assess_type}">${escapeHtml(at.assess_type)} v${at.assess_version}</option>`).join("");
  } catch (err) {
    console.error(err);
  }
}

async function editProject(projectId) {
  try {
    const response = await fetch(`/api/projects/${projectId}`);
    const data = await response.json();
    document.getElementById("projectModalTitle").textContent = "Edit Project";
    document.getElementById("projectId").value = data.project.id;
    document.getElementById("projectCiNumber").value = data.project.ci_number || "Auto-generated";
    document.getElementById("projectName").value = data.project.project_name || "";
    document.getElementById("projectNumber").value = data.project.project_id || "";
    document.getElementById("projectAddress").value = data.project.address || "";
    document.getElementById("projectCity").value = data.project.city || "";
    document.getElementById("projectState").value = data.project.state || "";
    document.getElementById("projectCustCountry").value = data.project.cust_country || "Canada";
    document.getElementById("projectJobCountry").value = data.project.job_country || "Canada";
    document.getElementById("projectStage").value = data.project.project_stage || "";
    document.getElementById("projectExtraInfo").value = data.project.extra_info || "";
    document.getElementById("projectCiNote").value = data.project.ci_note || "";
    document.getElementById("customerName").value = data.project.customer_name || "";
    document.getElementById("projectType").value = data.project.project_type || "";
    document.getElementById("jobAddress").value = data.project.job_address || "";
    document.getElementById("jobCity").value = data.project.job_city || "";
    document.getElementById("jobState").value = data.project.job_state || "";
    document.getElementById("contractorName").value = data.project.contractor_name || "";
    document.getElementById("contractorPhone").value = data.project.contractor_phone || "";
    document.getElementById("contractorCompany").value = data.project.contractor_company || "";
    document.getElementById("uploadDate").value = data.project.upload_date ? new Date(data.project.upload_date).toISOString().split("T")[0] : "";
    await loadProjectAssessTypes();
    setTimeout(() => {
      document.getElementById("projectAssessType").value = data.project.assess_type || "";
    }, 100);
    document.getElementById("copyProjectBtnModal").style.display = "block";
    document.getElementById("projectModal").style.display = "block";
  } catch (err) {
    showToast("Error loading project: " + err.message, "error");
  }
}

async function saveProject() {
  const projectId = document.getElementById("projectId").value;
  const projectData = {
    client_id: currentClientId,
    project_name: document.getElementById("projectName").value,
    project_id: document.getElementById("projectNumber").value,
    customer_name: document.getElementById("customerName").value,
    project_type: document.getElementById("projectType").value,
    assess_type: document.getElementById("projectAssessType").value,
    address: document.getElementById("projectAddress").value,
    city: document.getElementById("projectCity").value,
    state: document.getElementById("projectState").value,
    job_address: document.getElementById("jobAddress").value,
    job_city: document.getElementById("jobCity").value,
    job_state: document.getElementById("jobState").value,
    cust_country: document.getElementById("projectCustCountry").value,
    job_country: document.getElementById("projectJobCountry").value,
    project_stage: document.getElementById("projectStage").value,
    extra_info: document.getElementById("projectExtraInfo").value,
    ci_note: document.getElementById("projectCiNote").value,
    contractor_name: document.getElementById("contractorName").value,
    contractor_phone: document.getElementById("contractorPhone").value,
    contractor_company: document.getElementById("contractorCompany").value,
    upload_date: document.getElementById("uploadDate").value,
  };
  if (!projectData.customer_name) {
    showToast("Customer/Company Name is required", "error");
    return;
  }
  if (!projectData.assess_type) {
    showToast("Assessment Type is required", "error");
    return;
  }
  try {
    let response;
    if (projectId)
      response = await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectData),
      });
    else
      response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(projectData) });
    if (response.ok) {
      showToast("Project saved successfully", "success");
      closeProjectModal();
      loadProjects();
    } else {
      const error = await response.json();
      showToast("Error: " + (error.error || "Unknown error"), "error");
    }
  } catch (err) {
    showToast("Error saving project: " + err.message, "error");
  }
}

async function saveProjectAndAddNext() {
  await saveProject();
  showAddProjectModal();
}

function closeProjectModal() {
  document.getElementById("projectModal").style.display = "none";
}

async function bulkDeleteProjects() {
  const checkboxes = document.querySelectorAll(".project-select-cb:checked");
  if (checkboxes.length === 0) {
    showToast("Please select at least one project.", "info");
    return;
  }
  if (!confirm(`Delete ${checkboxes.length} selected project(s)?`)) return;
  let successCount = 0,
    failCount = 0;
  for (let cb of checkboxes) {
    try {
      const response = await fetch(`/api/projects/${cb.value}`, { method: "DELETE" });
      if (response.ok) successCount++;
      else failCount++;
    } catch (e) {
      failCount++;
    }
  }
  if (failCount > 0) showToast(`Deleted ${successCount} projects, ${failCount} failed.`, "warning");
  else showToast(`Successfully deleted ${successCount} project(s)`, "success");
  loadProjects();
}

function makeCopyFromModal() {
  document.getElementById("projectModalTitle").textContent = "Clone Project (Edit before saving)";
  document.getElementById("projectId").value = "";
  document.getElementById("projectCiNumber").value = "Auto-generated";
  document.getElementById("uploadDate").value = new Date().toISOString().split("T")[0];
  const custName = document.getElementById("customerName").value;
  if (custName && !custName.endsWith("_COPY")) document.getElementById("customerName").value = custName + "_COPY";
  document.getElementById("copyProjectBtnModal").style.display = "none";
  showToast("Project copied! Make your changes and click Save.", "info");
}

async function exportProjects() {
  if (!currentClientId) {
    showToast("Please select a client first", "error");
    return;
  }
  try {
    const response = await fetch(`/api/clients/${currentClientId}/projects`);
    const projects = await response.json();
    if (projects.length === 0) {
      showToast("No projects available to export", "error");
      return;
    }
    const exportData = projects.map((p) => ({
      "CI #": p.ci_number,
      "Project Name": p.project_name,
      "Project ID": p.project_id,
      "Customer Name": p.customer_name,
      "Project Type": p.project_type,
      "Assess Type": p.assess_type,
      "Customer Address": p.address,
      "Customer City": p.city,
      "Customer State": p.state,
      "Customer Country": p.cust_country,
      "Job Address": p.job_address,
      "Job City": p.job_city,
      "Job State": p.job_state,
      "Job Country": p.job_country,
      "Contractor Name": p.contractor_name,
      "Contractor Company": p.contractor_company,
      "Contractor Phone": p.contractor_phone,
      Stage: p.project_stage,
      "Upload Date": p.upload_date,
      "Created Date": p.created_at ? new Date(p.created_at).toLocaleDateString() : "",
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Projects");
    XLSX.writeFile(wb, `Projects_Client_${currentClientId}.xlsx`);
    showToast("Projects exported successfully", "success");
  } catch (err) {
    showToast("Error exporting projects", "error");
  }
}

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("showProjectsBtn")?.addEventListener("click", loadProjects);
  document.getElementById("newProjectBtn")?.addEventListener("click", showAddProjectModal);
  document.getElementById("uploadExcelBtn")?.addEventListener("click", validateUploadPrerequisites);
  document.getElementById("excelFile")?.addEventListener("change", uploadExcel);
  document.getElementById("bulkDeleteProjectsBtn")?.addEventListener("click", bulkDeleteProjects);
  document.getElementById("exportProjectsBtn")?.addEventListener("click", exportProjects);
  document.getElementById("selectAllProjects")?.addEventListener("click", (e) => toggleAll(e.target, "project-select-cb"));
  document.getElementById("saveProjectBtn")?.addEventListener("click", saveProject);
  document.getElementById("saveProjectAndAddNextBtn")?.addEventListener("click", saveProjectAndAddNext);
  document.getElementById("closeProjectBtn")?.addEventListener("click", closeProjectModal);
  document.getElementById("copyProjectBtnModal")?.addEventListener("click", makeCopyFromModal);
  document.getElementById("manageMappingsBtn")?.addEventListener("click", () => {
    if (window.openMappingsModal) window.openMappingsModal();
  });
});

// Exports
window.loadClientDropdown = loadClientDropdown;
window.loadAssessTypesForProject = loadAssessTypesForProject;
window.loadProjectMappingTemplates = loadProjectMappingTemplates;
window.checkUploadButtonState = checkUploadButtonState;
window.validateUploadPrerequisites = validateUploadPrerequisites;
window.uploadExcel = uploadExcel;
window.loadProjects = loadProjects;
window.changePage = changePage;
window.showAddProjectModal = showAddProjectModal;
window.editProject = editProject;
window.closeProjectModal = closeProjectModal;
window.bulkDeleteProjects = bulkDeleteProjects;
window.makeCopyFromModal = makeCopyFromModal;
window.exportProjects = exportProjects;
window.saveProject = saveProject;
window.saveProjectAndAddNext = saveProjectAndAddNext;
