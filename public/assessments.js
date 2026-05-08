// ==================== ASSESSMENT TYPES MANAGEMENT ====================

async function loadAssessTypeClientDropdown() {
  try {
    const response = await fetch("/api/clients");
    const clients = await response.json();
    const activeClients = clients.filter((c) => c.is_active === true);
    const select = document.getElementById("assessTypeClientSelect");
    select.innerHTML =
      '<option value="all">-- All Clients --</option>' +
      activeClients.map((client) => `<option value="${client.id}">${escapeHtml(client.client_name)}</option>`).join("");
    const modalSelect = document.getElementById("assessTypeClientSelectModal");
    modalSelect.innerHTML =
      '<option value="">-- Select a Client --</option>' +
      activeClients.map((client) => `<option value="${client.id}">${escapeHtml(client.client_name)}</option>`).join("");
    if (currentAssessTypeClientId && currentAssessTypeClientId !== "all") select.value = currentAssessTypeClientId;
    else select.value = "all";
    select.onchange = function () {
      currentAssessTypeClientId = select.value;
      showAllAssessTypes = false;
      loadAssessTypesList(false);
    };
    loadAssessTypesList(false);
  } catch (err) {
    console.error(err);
  }
}

async function loadAssessTypesList(showAll = false) {
  showAllAssessTypes = showAll;
  const select = document.getElementById("assessTypeClientSelect");
  const clientId = select.value;
  const activeBtn = document.getElementById("showActiveAssessTypesBtn");
  const allBtn = document.getElementById("showAllAssessTypesBtn");
  if (showAll) {
    activeBtn.style.backgroundColor = "#9aa0a6";
    allBtn.style.backgroundColor = "#1a73e8";
    activeBtn.innerText = "Show Active";
    allBtn.innerText = "✓ Show All";
  } else {
    activeBtn.style.backgroundColor = "#1a73e8";
    allBtn.style.backgroundColor = "#9aa0a6";
    activeBtn.innerText = "✓ Show Active";
    allBtn.innerText = "Show All";
  }
  try {
    let url;
    if (clientId === "all") url = `/api/assess-types/all${showAll ? "?showAll=true" : ""}`;
    else {
      if (!clientId) {
        document.getElementById("assessTypesBody").innerHTML =
          '<tr><td colspan="7" style="text-align: center; padding: 30px;">Select a client to view assessment types</td></tr>';
        return;
      }
      currentAssessTypeClientId = clientId;
      url = `/api/assess-types/client/${clientId}${showAll ? "?showAll=true" : ""}`;
    }
    const response = await fetch(url);
    allAssessTypesData = await response.json();
    currentAssessPage = 1;
    totalAssessPages = Math.ceil(allAssessTypesData.length / itemsPerPage);
    renderAssessTypesPage();
    renderAssessPagination();
  } catch (err) {
    console.error(err);
    document.getElementById("assessTypesBody").innerHTML =
      '<tr><td colspan="7" style="text-align: center; padding: 30px; color: red;">Error loading assessment types.</td></tr>';
  }
}

function renderAssessTypesPage() {
  const tbody = document.getElementById("assessTypesBody");
  const select = document.getElementById("assessTypeClientSelect");
  const start = (currentAssessPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const pageData = allAssessTypesData.slice(start, end);
  document.getElementById("selectAllAssessTypes").checked = false;
  if (pageData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 30px;">No assessment types found.</td></tr>';
    return;
  }
  tbody.innerHTML = pageData
    .map((at) => {
      let displayClientName = at.client_name;
      if (!displayClientName && select.value !== "all" && select.selectedIndex > 0) displayClientName = select.options[select.selectedIndex].text;
      return `<tr ondblclick="editAssessType(${at.id})" style="cursor: pointer;" title="✏️ Double-click to edit">
      <td style="text-align: center;"><input type="checkbox" class="assess-select-cb" value="${at.id}" onclick="event.stopPropagation()"></td>
      <td class="ci-number">${escapeHtml(at.assess_type)}</td>
      <td>${at.is_active ? '<span class="badge-active">Active</span>' : '<span class="badge-inactive">Inactive</span>'}</td>
      <td>${escapeHtml(displayClientName)} ${at.is_default ? '<span class="default-star" title="Default assessment type for this client">✅</span>' : ""}</td>
      <td>${escapeHtml(at.assess_full_name) || "—"}</td>
      <td>v${at.assess_version}</td>
      <td style="text-align: right;"></td>
    </tr>`;
    })
    .join("");
}

function renderAssessPagination() {
  const container = document.getElementById("assessPaginationControls");
  const infoContainer = document.getElementById("assessPaginationInfo");
  if (totalAssessPages <= 1) {
    container.classList.add("hidden");
    infoContainer.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  infoContainer.classList.remove("hidden");
  let html = `<button onclick="changeAssessPage(1)" ${currentAssessPage === 1 ? "disabled" : ""}>First</button>`;
  html += `<button onclick="changeAssessPage(${currentAssessPage - 1})" ${currentAssessPage === 1 ? "disabled" : ""}>Prev</button>`;
  let start = Math.max(1, currentAssessPage - 2);
  let end = Math.min(totalAssessPages, currentAssessPage + 2);
  if (start > 1) html += `<button onclick="changeAssessPage(${start - 1})">...</button>`;
  for (let i = start; i <= end; i++)
    html += `<button onclick="changeAssessPage(${i})" class="${i === currentAssessPage ? "active" : ""}">${i}</button>`;
  if (end < totalAssessPages) html += `<button onclick="changeAssessPage(${end + 1})">...</button>`;
  html += `<button onclick="changeAssessPage(${currentAssessPage + 1})" ${currentAssessPage === totalAssessPages ? "disabled" : ""}>Next</button>`;
  html += `<button onclick="changeAssessPage(${totalAssessPages})" ${currentAssessPage === totalAssessPages ? "disabled" : ""}>Last</button>`;
  container.innerHTML = html;
  infoContainer.innerHTML = `Showing ${(currentAssessPage - 1) * itemsPerPage + 1} to ${Math.min(currentAssessPage * itemsPerPage, allAssessTypesData.length)} of ${allAssessTypesData.length} assessment types`;
}

function changeAssessPage(page) {
  if (page < 1 || page > totalAssessPages) return;
  currentAssessPage = page;
  renderAssessTypesPage();
  renderAssessPagination();
}

function showAddAssessTypeModal() {
  const clientId = document.getElementById("assessTypeClientSelect").value;
  if (!clientId || clientId === "all") {
    showToast("Please select a specific client first", "error");
    return;
  }
  document.getElementById("assessTypeModalTitle").textContent = "Add Assessment Type";
  document.getElementById("assessTypeForm").reset();
  document.getElementById("assessTypeId").value = "";
  document.getElementById("assessTypeVersion").value = 1;
  document.getElementById("assessTypeIsActive").checked = true;
  document.getElementById("assessTypeIsDefault").checked = false;
  document.getElementById("assessTypeClientSelectModal").value = clientId;
  document.getElementById("copyAssessBtnModal").style.display = "none";
  document.getElementById("assessTypeModal").style.display = "block";
}

async function editAssessType(id) {
  try {
    const response = await fetch(`/api/assess-types/by-id/${id}`);
    const at = await response.json();
    document.getElementById("assessTypeModalTitle").textContent = "Edit Assessment Type";
    document.getElementById("assessTypeId").value = at.id;
    document.getElementById("assessTypeCode").value = at.assess_type;
    document.getElementById("assessFullName").value = at.assess_full_name || "";
    document.getElementById("nameOnReport").value = at.name_on_report || "";
    document.getElementById("assessTypeVersion").value = at.assess_version;
    document.getElementById("assessTypeDescription").value = at.assess_type_description || "";
    document.getElementById("assessTypeIsDefault").checked = at.is_default === true;
    document.getElementById("assessTypeIsActive").checked = at.is_active === true;
    document.getElementById("assessTypeClientSelectModal").value = at.client_id;
    document.getElementById("copyAssessBtnModal").style.display = "block";
    document.getElementById("assessTypeModal").style.display = "block";
  } catch (err) {
    showToast("Error loading assessment type: " + err.message, "error");
  }
}

async function saveAssessType() {
  const id = document.getElementById("assessTypeId").value;
  const modalSelect = document.getElementById("assessTypeClientSelectModal");
  const clientId = modalSelect.value;
  if (!clientId) {
    showToast("Please select a client", "error");
    return;
  }
  const assessTypeData = {
    client_id: parseInt(clientId),
    assess_type: document.getElementById("assessTypeCode").value,
    assess_full_name: document.getElementById("assessFullName").value,
    name_on_report: document.getElementById("nameOnReport").value,
    assess_version: parseInt(document.getElementById("assessTypeVersion").value),
    assess_type_description: document.getElementById("assessTypeDescription").value,
    is_default: document.getElementById("assessTypeIsDefault").checked,
    is_active: document.getElementById("assessTypeIsActive").checked,
    created_by: "admin",
  };
  if (!assessTypeData.assess_type) {
    showToast("Assessment Type Code is required", "error");
    return;
  }
  try {
    let response;
    if (id)
      response = await fetch(`/api/assess-types/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assessTypeData),
      });
    else
      response = await fetch("/api/assess-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assessTypeData),
      });
    if (response.ok) {
      showToast(id ? "Assessment Type updated" : "Assessment Type added", "success");
      closeAssessTypeModal();
      loadAssessTypesList(showAllAssessTypes);
    } else {
      const error = await response.json();
      showToast("Error: " + (error.error || "Unknown error"), "error");
    }
  } catch (err) {
    showToast("Error saving assessment type: " + err.message, "error");
  }
}

async function saveAndAddNext() {
  const id = document.getElementById("assessTypeId").value;
  const modalSelect = document.getElementById("assessTypeClientSelectModal");
  const clientId = modalSelect.value;
  if (!clientId) {
    showToast("Please select a client", "error");
    return;
  }
  const assessTypeData = {
    client_id: parseInt(clientId),
    assess_type: document.getElementById("assessTypeCode").value,
    assess_full_name: document.getElementById("assessFullName").value,
    name_on_report: document.getElementById("nameOnReport").value,
    assess_version: parseInt(document.getElementById("assessTypeVersion").value),
    assess_type_description: document.getElementById("assessTypeDescription").value,
    is_default: document.getElementById("assessTypeIsDefault").checked,
    is_active: document.getElementById("assessTypeIsActive").checked,
    created_by: "admin",
  };
  if (!assessTypeData.assess_type) {
    showToast("Assessment Type Code is required", "error");
    return;
  }
  try {
    let response;
    if (id)
      response = await fetch(`/api/assess-types/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assessTypeData),
      });
    else
      response = await fetch("/api/assess-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assessTypeData),
      });
    if (response.ok) {
      showToast(id ? "Assessment Type updated" : "Assessment Type added", "success");
      document.getElementById("assessTypeForm").reset();
      document.getElementById("assessTypeId").value = "";
      document.getElementById("assessTypeVersion").value = 1;
      document.getElementById("assessTypeIsActive").checked = true;
      document.getElementById("assessTypeIsDefault").checked = false;
      document.getElementById("assessTypeCode").focus();
      modalSelect.value = clientId;
      loadAssessTypesList(showAllAssessTypes);
    } else {
      const error = await response.json();
      showToast("Error: " + (error.error || "Unknown error"), "error");
    }
  } catch (err) {
    showToast("Error saving assessment type: " + err.message, "error");
  }
}

function closeAssessTypeModal() {
  document.getElementById("assessTypeModal").style.display = "none";
}

// Update bulkDeleteAssessTypes function:
async function bulkDeleteAssessTypes() {
  const checkboxes = document.querySelectorAll(".assess-select-cb:checked");
  if (checkboxes.length === 0) {
    showToast("Please select at least one assessment type.", "info");
    return;
  }

  const confirmed = await showConfirmation({
    title: "Delete Assessment Types",
    message: `Delete ${checkboxes.length} selected assessment type(s)?`,
    confirmText: "Delete",
    cancelText: "Cancel",
    danger: true,
  });

  if (!confirmed) return;

  const deleteBtn = document.getElementById("bulkDeleteAssessTypesBtn");

  await withLoading(
    deleteBtn,
    async () => {
      let successCount = 0,
        failCount = 0;
      showToast("⏳ Deleting assessment types...", "info");

      for (let cb of checkboxes) {
        try {
          const response = await fetch(`/api/assess-types/${cb.value}`, { method: "DELETE" });
          if (response.ok) successCount++;
          else failCount++;
        } catch (e) {
          failCount++;
        }
      }

      if (failCount > 0) {
        showToast(`Deleted ${successCount} assess types, ${failCount} failed.`, "warning");
      } else {
        showToast(`Successfully deleted ${successCount} assess type(s)`, "success");
      }

      await loadAssessTypesList(showAllAssessTypes);
      const masterCheckbox = document.getElementById("selectAllAssessTypes");
      if (masterCheckbox) masterCheckbox.checked = false;
    },
    "Deleting...",
  );
}

// Update saveAssessType function with loading:
async function saveAssessType() {
  const id = document.getElementById("assessTypeId").value;
  const saveBtn = document.getElementById("saveAssessTypeBtn");
  const modalSelect = document.getElementById("assessTypeClientSelectModal");
  const clientId = modalSelect.value;

  if (!clientId) {
    showToast("Please select a client", "error");
    return;
  }

  const assessTypeData = {
    client_id: parseInt(clientId),
    assess_type: document.getElementById("assessTypeCode").value,
    assess_full_name: document.getElementById("assessFullName").value,
    name_on_report: document.getElementById("nameOnReport").value,
    assess_version: parseInt(document.getElementById("assessTypeVersion").value),
    assess_type_description: document.getElementById("assessTypeDescription").value,
    is_default: document.getElementById("assessTypeIsDefault").checked,
    is_active: document.getElementById("assessTypeIsActive").checked,
    created_by: "admin",
  };

  if (!assessTypeData.assess_type) {
    showToast("Assessment Type Code is required", "error");
    return;
  }

  await withLoading(
    saveBtn,
    async () => {
      try {
        let response;
        if (id) {
          response = await fetch(`/api/assess-types/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(assessTypeData),
          });
        } else {
          response = await fetch("/api/assess-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(assessTypeData),
          });
        }

        if (response.ok) {
          showToast(id ? "Assessment Type updated" : "Assessment Type added", "success");
          closeAssessTypeModal();
          await loadAssessTypesList(showAllAssessTypes);
        } else {
          const error = await response.json();
          showToast("Error: " + (error.error || "Unknown error"), "error");
        }
      } catch (err) {
        showToast("Error saving assessment type: " + err.message, "error");
      }
    },
    "Saving...",
  );
}

function makeCopyAssessFromModal() {
  document.getElementById("assessTypeModalTitle").textContent = "Clone Assessment Type (Edit before saving)";
  document.getElementById("assessTypeId").value = "";
  const assessCode = document.getElementById("assessTypeCode").value;
  if (assessCode && !assessCode.endsWith("_COPY")) document.getElementById("assessTypeCode").value = assessCode + "_COPY";
  document.getElementById("assessTypeIsDefault").checked = false;
  document.getElementById("copyAssessBtnModal").style.display = "none";
  showToast("Assessment Type copied! Update the code and click Save.", "info");
}

async function exportAssessTypes(format) {
  const select = document.getElementById("assessTypeClientSelect");
  if (select.value === "all") window.open(`/api/assess-types/all/export?format=${format}&showAll=${showAllAssessTypes ? "true" : "false"}`, "_blank");
  else {
    if (!currentAssessTypeClientId || currentAssessTypeClientId === "all") {
      showToast("Please select a client first", "error");
      return;
    }
    window.open(
      `/api/assess-types/export/client/${currentAssessTypeClientId}?format=${format}&showAll=${showAllAssessTypes ? "true" : "false"}`,
      "_blank",
    );
  }
}

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("showActiveAssessTypesBtn")?.addEventListener("click", () => loadAssessTypesList(false));
  document.getElementById("showAllAssessTypesBtn")?.addEventListener("click", () => loadAssessTypesList(true));
  document.getElementById("addAssessTypeBtn")?.addEventListener("click", showAddAssessTypeModal);
  document.getElementById("bulkDeleteAssessTypesBtn")?.addEventListener("click", bulkDeleteAssessTypes);
  document.getElementById("exportAssessTypesBtn")?.addEventListener("click", () => exportAssessTypes("excel"));
  document.getElementById("selectAllAssessTypes")?.addEventListener("click", (e) => toggleAll(e.target, "assess-select-cb"));
  document.getElementById("saveAssessTypeBtn")?.addEventListener("click", saveAssessType);
  document.getElementById("saveAssessAndAddNextBtn")?.addEventListener("click", saveAndAddNext);
  document.getElementById("closeAssessTypeBtn")?.addEventListener("click", closeAssessTypeModal);
  document.getElementById("copyAssessBtnModal")?.addEventListener("click", makeCopyAssessFromModal);
});

// Exports
window.loadAssessTypeClientDropdown = loadAssessTypeClientDropdown;
window.loadAssessTypesList = loadAssessTypesList;
window.changeAssessPage = changeAssessPage;
window.editAssessType = editAssessType;
window.closeAssessTypeModal = closeAssessTypeModal;
window.bulkDeleteAssessTypes = bulkDeleteAssessTypes;
window.makeCopyAssessFromModal = makeCopyAssessFromModal;
window.exportAssessTypes = exportAssessTypes;
window.saveAndAddNext = saveAndAddNext;
window.saveAssessType = saveAssessType;
window.showAddAssessTypeModal = showAddAssessTypeModal;
