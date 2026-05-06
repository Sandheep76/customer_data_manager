// ==================== CLIENTS MANAGEMENT ====================

async function loadClientsList(showAll = false) {
  showAllClients = showAll;
  const activeBtn = document.getElementById("showActiveClientsBtn");
  const allBtn = document.getElementById("showAllClientsBtn");

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
    const url = showAll ? "/api/clients?showAll=true" : "/api/clients";
    const response = await fetch(url);
    allClientsData = await response.json();
    currentClientPage = 1;
    totalClientPages = Math.ceil(allClientsData.length / itemsPerPage);
    renderClientsPage();
    renderClientPagination();
  } catch (err) {
    console.error(err);
    document.getElementById("clientsBody").innerHTML =
      '<table><td colspan="7" style="text-align: center; padding: 30px; color: red;">Error loading clients.</td></tr>';
  }
}

function renderClientsPage() {
  const tbody = document.getElementById("clientsBody");
  const start = (currentClientPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const pageClients = allClientsData.slice(start, end);
  document.getElementById("selectAllClients").checked = false;

  if (pageClients.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 30px;">No clients found.</td></tr>';
    return;
  }

  tbody.innerHTML = pageClients
    .map(
      (client) => `
    <tr ondblclick="editClient(${client.id})" style="cursor: pointer;" title="✏️ Double-click to edit">
      <td style="text-align: center;"><input type="checkbox" class="client-select-cb" value="${client.id}" onclick="event.stopPropagation()"></td>
      <td style="width: 180px;">${client.client_logo ? `<img src="${client.client_logo}" alt="logo" style="width: 160px; height: 45px; object-fit: contain; border-radius: 6px;">` : '<div style="width:160px;height:45px;background:#e0e0e0;display:flex;align-items:center;justify-content:center;border-radius:6px;">🏢</div>'}</td>
      <td class="ci-number">${escapeHtml(client.client_name)}</td>
      <td>${client.is_active ? '<span class="badge-active">Active</span>' : '<span class="badge-inactive">Inactive</span>'}</td>
      <td>${client.client_abbreviation ? escapeHtml(client.client_abbreviation) : "-"}</td>
      <td>${client.industry || "-"}</td>
      <td style="text-align: right;"></td>
    </tr>
  `,
    )
    .join("");
}

function renderClientPagination() {
  const container = document.getElementById("clientPaginationControls");
  const infoContainer = document.getElementById("clientPaginationInfo");
  if (totalClientPages <= 1) {
    container.classList.add("hidden");
    infoContainer.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  infoContainer.classList.remove("hidden");

  let html = `<button onclick="changeClientPage(1)" ${currentClientPage === 1 ? "disabled" : ""}>First</button>`;
  html += `<button onclick="changeClientPage(${currentClientPage - 1})" ${currentClientPage === 1 ? "disabled" : ""}>Prev</button>`;
  let start = Math.max(1, currentClientPage - 2);
  let end = Math.min(totalClientPages, currentClientPage + 2);
  if (start > 1) html += `<button onclick="changeClientPage(${start - 1})">...</button>`;
  for (let i = start; i <= end; i++) {
    html += `<button onclick="changeClientPage(${i})" class="${i === currentClientPage ? "active" : ""}">${i}</button>`;
  }
  if (end < totalClientPages) html += `<button onclick="changeClientPage(${end + 1})">...</button>`;
  html += `<button onclick="changeClientPage(${currentClientPage + 1})" ${currentClientPage === totalClientPages ? "disabled" : ""}>Next</button>`;
  html += `<button onclick="changeClientPage(${totalClientPages})" ${currentClientPage === totalClientPages ? "disabled" : ""}>Last</button>`;
  container.innerHTML = html;
  infoContainer.innerHTML = `Showing ${(currentClientPage - 1) * itemsPerPage + 1} to ${Math.min(currentClientPage * itemsPerPage, allClientsData.length)} of ${allClientsData.length} clients`;
}

function changeClientPage(page) {
  if (page < 1 || page > totalClientPages) return;
  currentClientPage = page;
  renderClientsPage();
  renderClientPagination();
}

function showAddClientModal() {
  document.getElementById("clientModalTitle").textContent = "Add Client";
  document.getElementById("clientForm").reset();
  document.getElementById("clientId").value = "";
  document.getElementById("clientDefaultCustCountry").value = "Canada";
  document.getElementById("clientDefaultJobCountry").value = "Canada";
  document.getElementById("clientIsActive").checked = true;
  document.getElementById("copyClientBtnModal").style.display = "none";
  document.getElementById("logoAction").value = "";
  document.getElementById("editClientLogoFile").value = "";
  document.getElementById("modalLogoPreview").innerHTML =
    '<div style="width:120px;height:35px;background:#e0e0e0;display:flex;align-items:center;justify-content:center;border-radius:6px;">🏢</div>';
  document.getElementById("removeLogoBtn").style.display = "none";
  document.getElementById("clientModal").style.display = "block";
}

async function editClient(clientId) {
  try {
    const response = await fetch(`/api/clients/${clientId}`);
    const client = await response.json();
    document.getElementById("clientModalTitle").textContent = "Edit Client";
    document.getElementById("clientId").value = client.id;
    document.getElementById("clientName").value = client.client_name;
    document.getElementById("clientAbbreviation").value = client.client_abbreviation || "";
    document.getElementById("clientIndustry").value = client.industry || "";
    document.getElementById("clientContactPerson").value = client.contact_person || "";
    document.getElementById("clientContactEmail").value = client.contact_email || "";
    document.getElementById("clientContactPhone").value = client.contact_phone || "";
    document.getElementById("clientDefaultCustCountry").value = client.default_cust_country || "Canada";
    document.getElementById("clientDefaultJobCountry").value = client.default_job_country || "Canada";
    document.getElementById("clientIsActive").checked = client.is_active === true;
    document.getElementById("copyClientBtnModal").style.display = "block";
    document.getElementById("logoAction").value = "";
    document.getElementById("editClientLogoFile").value = "";
    if (client.client_logo) {
      document.getElementById("modalLogoPreview").innerHTML =
        `<img src="${client.client_logo}" style="max-width:120px;max-height:35px;border-radius:6px;object-fit:contain;">`;
      document.getElementById("removeLogoBtn").style.display = "inline-block";
    } else {
      document.getElementById("modalLogoPreview").innerHTML =
        '<div style="width:120px;height:35px;background:#e0e0e0;display:flex;align-items:center;justify-content:center;border-radius:6px;">🏢</div>';
      document.getElementById("removeLogoBtn").style.display = "none";
    }
    document.getElementById("clientModal").style.display = "block";
  } catch (err) {
    showToast("Error loading client: " + err.message, "error");
  }
}

async function saveClient() {
  const clientId = document.getElementById("clientId").value;
  const clientData = {
    client_name: document.getElementById("clientName").value,
    client_abbreviation: document.getElementById("clientAbbreviation").value,
    industry: document.getElementById("clientIndustry").value,
    contact_person: document.getElementById("clientContactPerson").value,
    contact_email: document.getElementById("clientContactEmail").value,
    contact_phone: document.getElementById("clientContactPhone").value,
    default_cust_country: document.getElementById("clientDefaultCustCountry").value,
    default_job_country: document.getElementById("clientDefaultJobCountry").value,
    is_active: document.getElementById("clientIsActive").checked,
  };
  if (!clientData.client_name) {
    showToast("Client Name is required", "error");
    return;
  }
  try {
    let response;
    if (clientId) {
      response = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clientData),
      });
    } else {
      response = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(clientData) });
    }
    if (response.ok) {
      const savedClient = await response.json();
      const finalClientId = clientId || savedClient.id;
      const logoAction = document.getElementById("logoAction").value;
      try {
        if (logoAction === "remove" && clientId) {
          await fetch(`/api/clients/${finalClientId}/logo`, { method: "DELETE" });
        } else if (logoAction === "upload") {
          const logoFile = document.getElementById("editClientLogoFile").files[0];
          if (logoFile) {
            const formData = new FormData();
            formData.append("logo", logoFile);
            await fetch(`/api/clients/${finalClientId}/logo`, { method: "POST", body: formData });
          }
        }
      } catch (e) {
        console.error("Logo sync failed", e);
      }
      showToast(clientId ? "Client updated" : "Client added", "success");
      closeClientModal();
      loadClientsList(showAllClients);
      if (window.loadClientDropdown) window.loadClientDropdown();
      if (window.loadAssessTypeClientDropdown) window.loadAssessTypeClientDropdown();
    } else {
      const error = await response.json();
      showToast("Error: " + (error.error || "Unknown error"), "error");
    }
  } catch (err) {
    showToast("Error saving client: " + err.message, "error");
  }
}

async function saveClientAndAddNext() {
  await saveClient();
  showAddClientModal();
  document.getElementById("clientName").focus();
}

function previewEditClientLogo(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      document.getElementById("modalLogoPreview").innerHTML =
        `<img src="${e.target.result}" style="max-width:120px;max-height:35px;border-radius:6px;object-fit:contain;border:2px dashed #1a73e8;padding:2px;">`;
      document.getElementById("logoAction").value = "upload";
      document.getElementById("removeLogoBtn").style.display = "inline-block";
    };
    reader.readAsDataURL(file);
  }
}

function markLogoForRemoval() {
  document.getElementById("modalLogoPreview").innerHTML =
    '<div style="width:120px;height:35px;background:#e0e0e0;display:flex;align-items:center;justify-content:center;border-radius:6px;">🏢</div>';
  document.getElementById("editClientLogoFile").value = "";
  document.getElementById("logoAction").value = "remove";
  document.getElementById("removeLogoBtn").style.display = "none";
  showToast("Logo will be removed when you save", "info");
}

function closeClientModal() {
  document.getElementById("clientModal").style.display = "none";
}

async function bulkDeleteClients() {
  const checkboxes = document.querySelectorAll(".client-select-cb:checked");
  if (checkboxes.length === 0) {
    showToast("Please select at least one client.", "info");
    return;
  }
  if (!confirm(`Delete ${checkboxes.length} selected client(s)? This will also delete their projects and data.`)) return;
  let successCount = 0,
    failCount = 0;
  for (let cb of checkboxes) {
    try {
      const response = await fetch(`/api/clients/${cb.value}`, { method: "DELETE" });
      if (response.ok) successCount++;
      else failCount++;
    } catch (e) {
      failCount++;
    }
  }
  if (failCount > 0) showToast(`Deleted ${successCount} clients, ${failCount} failed.`, "warning");
  else showToast(`Successfully deleted ${successCount} client(s)`, "success");
  loadClientsList(showAllClients);
  // Uncheck the master checkbox after delete
  const masterCheckbox = document.getElementById("selectAllClients");
  if (masterCheckbox) masterCheckbox.checked = false;
  if (window.loadClientDropdown) window.loadClientDropdown();
  if (window.loadAssessTypeClientDropdown) window.loadAssessTypeClientDropdown();
}

function makeCopyClientFromModal() {
  document.getElementById("clientModalTitle").textContent = "Clone Client (Edit before saving)";
  document.getElementById("clientId").value = "";
  const clientName = document.getElementById("clientName").value;
  if (clientName && !clientName.endsWith("_COPY")) document.getElementById("clientName").value = clientName + "_COPY";
  document.getElementById("modalLogoPreview").innerHTML =
    '<div style="width:120px;height:35px;background:#e0e0e0;display:flex;align-items:center;justify-content:center;border-radius:6px;">🏢</div>';
  document.getElementById("editClientLogoFile").value = "";
  document.getElementById("logoAction").value = "";
  document.getElementById("removeLogoBtn").style.display = "none";
  document.getElementById("copyClientBtnModal").style.display = "none";
  showToast("Client details copied! Update the name and click Save.", "info");
}

async function exportClients(format) {
  window.open(`/api/clients/export?format=${format}&showAll=${showAllClients ? "true" : "false"}`, "_blank");
}

// Event Listeners
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("showActiveClientsBtn")?.addEventListener("click", () => loadClientsList(false));
  document.getElementById("showAllClientsBtn")?.addEventListener("click", () => loadClientsList(true));
  document.getElementById("addClientBtn")?.addEventListener("click", showAddClientModal);
  document.getElementById("bulkDeleteClientsBtn")?.addEventListener("click", bulkDeleteClients);
  document.getElementById("exportClientsBtn")?.addEventListener("click", () => exportClients("excel"));
  document.getElementById("selectAllClients")?.addEventListener("click", (e) => toggleAll(e.target, "client-select-cb"));
  document.getElementById("uploadLogoBtn")?.addEventListener("click", () => document.getElementById("editClientLogoFile").click());
  document.getElementById("editClientLogoFile")?.addEventListener("change", previewEditClientLogo);
  document.getElementById("removeLogoBtn")?.addEventListener("click", markLogoForRemoval);
  document.getElementById("saveClientBtn")?.addEventListener("click", saveClient);
  document.getElementById("saveClientAndAddNextBtn")?.addEventListener("click", saveClientAndAddNext);
  document.getElementById("closeClientBtn")?.addEventListener("click", closeClientModal);
  document.getElementById("copyClientBtnModal")?.addEventListener("click", makeCopyClientFromModal);
});

// Exports
window.loadClientsList = loadClientsList;
window.changeClientPage = changeClientPage;
window.editClient = editClient;
window.closeClientModal = closeClientModal;
window.bulkDeleteClients = bulkDeleteClients;
window.makeCopyClientFromModal = makeCopyClientFromModal;
window.exportClients = exportClients;
window.markLogoForRemoval = markLogoForRemoval;
window.previewEditClientLogo = previewEditClientLogo;
window.saveClient = saveClient;
window.saveClientAndAddNext = saveClientAndAddNext;
window.showAddClientModal = showAddClientModal;
