// Mappings Management Module

function openMappingsModal() {
  if (currentClientId) currentMappingClientId = currentClientId;
  document.getElementById("mappingsModal").style.display = "block";
  loadMappingClientDropdownModal();
}

function closeMappingsModal() {
  document.getElementById("mappingsModal").style.display = "none";
  if (currentClientId && window.loadProjectMappingTemplates) window.loadProjectMappingTemplates();
  if (window.checkUploadButtonState) window.checkUploadButtonState();
}

async function loadMappingClientDropdownModal() {
  try {
    const response = await fetch("/api/clients");
    const clients = await response.json();
    const activeClients = clients.filter(c => c.is_active === true);
    const select = document.getElementById("mappingClientSelect");
    select.innerHTML = '<option value="">-- Select a Client --</option>' + activeClients.map(client => `<option value="${client.id}">${escapeHtml(client.client_name)}</option>`).join("");
    if (currentMappingClientId) select.value = currentMappingClientId;
    select.onchange = function () {
      const clientId = select.value;
      if (clientId) { currentMappingClientId = clientId; currentMappingName = null; isEditMode = false; loadMappingNamesModal(); }
      else resetMappingUIModal();
    };
    if (currentMappingClientId) loadMappingNamesModal();
  } catch (err) { console.error(err); }
}

async function loadMappingNamesModal() {
  try {
    const response = await fetch(`/api/column-mappings/${currentMappingClientId}/names`);
    const mappings = await response.json();
    const container = document.getElementById("mappingBadgesModal");
    const selectorDiv = document.getElementById("mappingSelectorModal");
    const deleteBtn = document.getElementById("deleteMappingBtnModal");
    const renameBtn = document.getElementById("renameMappingBtnModal");
    const exportBtn = document.getElementById("exportTemplateBtnModal");
    if (mappings.length === 0) {
      container.innerHTML = '<div style="color: #666; font-size:12px;">No mapping templates created yet. Click "New Mapping" to begin.</div>';
      selectorDiv.classList.remove("hidden");
      if (deleteBtn) deleteBtn.classList.add("hidden");
      if (renameBtn) renameBtn.classList.add("hidden");
      if (exportBtn) exportBtn.classList.add("hidden");
      document.getElementById("uploadColumnsAreaModal").classList.add("hidden");
      document.getElementById("mappingTableContainerModal").classList.add("hidden");
      document.getElementById("noMappingSelectedModal").style.display = "block";
      document.getElementById("noMappingSelectedModal").innerText = "No mapping templates exist. Create a new mapping.";
      currentMappingName = null;
      return;
    }
    selectorDiv.classList.remove("hidden");
    if (deleteBtn) deleteBtn.classList.add("hidden");
    if (renameBtn) renameBtn.classList.add("hidden");
    if (exportBtn) exportBtn.classList.add("hidden");
    let savedMappingsList = [];
    try {
      const savedResponse = await fetch(`/api/column-mappings/${currentMappingClientId}`);
      savedMappingsList = await savedResponse.json();
    } catch (e) { }
    const mappingsWithContent = new Set(savedMappingsList.map(m => m.mapping_name));
    container.innerHTML = mappings.map(m => {
      const hasContent = mappingsWithContent.has(m.mapping_name);
      const isActive = currentMappingName === m.mapping_name;
      const isUnsaved = isActive && !hasContent;
      let badgeClass = "mapping-badge";
      if (isActive) badgeClass += " active";
      if (isUnsaved) badgeClass += " unsaved";
      return `<span class="${badgeClass}" onclick="selectMappingModal('${escapeHtml(m.mapping_name)}')">${escapeHtml(m.mapping_name)}</span>`;
    }).join("");
    if (!currentMappingName) {
      document.getElementById("uploadColumnsAreaModal").classList.add("hidden");
      document.getElementById("mappingTableContainerModal").classList.add("hidden");
      document.getElementById("noMappingSelectedModal").style.display = "block";
      document.getElementById("noMappingSelectedModal").innerText = "Select a mapping template or create a new one to begin mapping columns.";
    } else {
      document.getElementById("uploadColumnsAreaModal").classList.remove("hidden");
      document.getElementById("noMappingSelectedModal").style.display = "none";
      if (deleteBtn) deleteBtn.classList.remove("hidden");
      if (renameBtn) renameBtn.classList.remove("hidden");
      if (exportBtn) exportBtn.classList.remove("hidden");
    }
  } catch (err) { console.error("Error loading mapping names:", err); }
}

async function selectMappingModal(mappingName) {
  currentMappingName = mappingName;
  isEditMode = true;
  currentExcelColumns = [];
  currentMappingsList = [];
  document.getElementById("mappingExcelFileModal").value = "";
  document.getElementById("uploadColumnsAreaModal").classList.remove("hidden");
  document.getElementById("mappingTableContainerModal").classList.add("hidden");
  document.getElementById("columnsStatusModal").innerHTML = "";
  document.getElementById("noMappingSelectedModal").style.display = "none";
  document.getElementById("deleteMappingBtnModal").classList.remove("hidden");
  document.getElementById("renameMappingBtnModal").classList.remove("hidden");
  if (document.getElementById("exportTemplateBtnModal")) document.getElementById("exportTemplateBtnModal").classList.remove("hidden");
  document.querySelectorAll("#mappingBadgesModal .mapping-badge").forEach(b => b.classList.remove("active", "unsaved"));
  const badges = document.querySelectorAll("#mappingBadgesModal .mapping-badge");
  for (let badge of badges) { if (badge.innerText === mappingName) { badge.classList.add("active"); break; } }
  try {
    const response = await fetch(`/api/column-mappings/${currentMappingClientId}?mappingName=${encodeURIComponent(mappingName)}`);
    const mappings = await response.json();
    currentMappingsList = mappings;
    if (mappings.length > 0) {
      currentExcelColumns = [...new Set(mappings.map(m => m.excel_column))];
      document.getElementById("columnsStatusModal").innerHTML = `<p class="status-success">✅ Loaded ${currentExcelColumns.length} mapped columns from "${escapeHtml(mappingName)}"</p>`;
      clearStatusMessage("columnsStatusModal");
      if (document.getElementById("exportTemplateBtnModal")) document.getElementById("exportTemplateBtnModal").classList.remove("hidden");
      renderMappingTableWithExistingModal();
      document.getElementById("mappingTableContainerModal").classList.remove("hidden");
    } else {
      const activeBadge = document.querySelector("#mappingBadgesModal .mapping-badge.active");
      if (activeBadge) activeBadge.classList.add("unsaved");
      document.getElementById("mappingTableContainerModal").classList.add("hidden");
      showToast("No mappings defined yet. Please click 📂 Load Data.", "info");
      document.getElementById("columnsStatusModal").innerHTML = "";
    }
  } catch (err) { document.getElementById("columnsStatusModal").innerHTML = `<p class="status-error">Error: ${escapeHtml(err.message)}</p>`; }
}

function renderMappingTableWithExistingModal() {
  const tbody = document.getElementById("mappingTableBodyModal");
  const existingMap = {};
  currentMappingsList.forEach(m => { existingMap[m.excel_column] = m.target_field; });
  if (currentExcelColumns.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No columns loaded. Upload an Excel file.</option>`).join("");
    return `<tr>
      <td><strong>${escapeHtml(col)}</strong></td>
      <td style="color:#666;font-style:italic;">${escapeHtml(String(currentSampleData[col] || "—").substring(0, 40))}</td>
      <td class="arrow-col">➡️</td>
      <td><select class="mapping-select" id="map_modal_${col.replace(/[^a-zA-Z0-9]/g, "_")}" data-column="${escapeHtml(col)}" onchange="updateMappingProgress()"><option value="">-- Select Field --</option>${optionsHtml}<option value="ignore" ${existingMap[col] === "ignore" ? "selected" : ""}>Do Not Import (Ignore)</option></select></td>
      <td><button class="btn-sm btn-secondary" onclick="addCustomRowModal('${escapeHtml(col)}')">+ Custom</button></td>
    </table>`;
  }).join("");
  updateMappingProgress();
}

function resetMappingUIModal() {
  currentMappingName = null;
  isEditMode = false;
  document.getElementById("mappingSelectorModal").classList.add("hidden");
  document.getElementById("uploadColumnsAreaModal").classList.add("hidden");
  document.getElementById("mappingTableContainerModal").classList.add("hidden");
  if (document.getElementById("deleteMappingBtnModal")) document.getElementById("deleteMappingBtnModal").classList.add("hidden");
  if (document.getElementById("renameMappingBtnModal")) document.getElementById("renameMappingBtnModal").classList.add("hidden");
  if (document.getElementById("exportTemplateBtnModal")) document.getElementById("exportTemplateBtnModal").classList.add("hidden");
  document.getElementById("mappingExcelFileModal").value = "";
  document.getElementById("noMappingSelectedModal").style.display = "block";
  document.getElementById("noMappingSelectedModal").innerText = "Select a client to view or create mapping templates";
}

function runSmartMatch() {
  const selects = document.querySelectorAll(".mapping-select");
  let matchCount = 0;
  selects.forEach(sel => {
    if (!sel.value) {
      const colName = sel.getAttribute("data-column");
      const suggestedMatch = attemptAutoMap(colName);
      if (suggestedMatch) { sel.value = suggestedMatch; matchCount++; }
    }
  });
  updateMappingProgress();
  if (matchCount > 0) showToast(`✨ Smart Match found ${matchCount} fields!`, "success");
  else showToast(`No new matches found.`, "info");
}

function updateMappingProgress() {
  const selects = document.querySelectorAll(".mapping-select");
  if (selects.length === 0) return;
  let mappedCount = 0;
  selects.forEach(sel => {
    const row = sel.closest("tr");
    if (sel.value) { mappedCount++; row.classList.add("mapped-row"); }
    else row.classList.remove("mapped-row");
  });
  document.getElementById("mappingProgressText").innerText = `Mapped: ${mappedCount} / ${selects.length}`;
  const saveBtn = document.getElementById("saveMappingBtn");
  if (saveBtn) saveBtn.disabled = mappedCount !== selects.length;
}

function ignoreUnmapped() {
  const selects = document.querySelectorAll(".mapping-select");
  selects.forEach(sel => { if (!sel.value) sel.value = "ignore"; });
  updateMappingProgress();
}

function addCustomRowModal(columnName) {
  const customField = prompt(`Enter custom field name for "${columnName}":`, columnName);
  if (customField) {
    const selectId = `map_modal_${columnName.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const select = document.getElementById(selectId);
    if (select) {
      if (!Array.from(select.options).some(opt => opt.value === `custom_${customField}`)) {
        const newOption = document.createElement("option");
        newOption.value = `custom_${customField}`;
        newOption.text = `Custom: ${customField}`;
        select.appendChild(newOption);
      }
      select.value = `custom_${customField}`;
      updateMappingProgress();
    }
  }
}

async function saveMappingsModal() {
  const mappings = [];
  for (const col of currentExcelColumns) {
    const select = document.getElementById(`map_modal_${col.replace(/[^a-zA-Z0-9]/g, "_")}`);
    if (select && select.value) mappings.push({ excel_column: col, target_field: select.value, is_custom_field: select.value.startsWith("custom_") });
  }
  if (mappings.length === 0) { showToast("No mappings to save", "error"); return; }
  const usedFields = mappings.map(m => m.target_field);
  const missingReq = REQUIRED_FIELDS.filter(rf => !usedFields.includes(rf));
  if (missingReq.length > 0) { showToast(`Missing required mappings: ${missingReq.join(", ")}.`, "error"); return; }
  try {
    const response = await fetch("/api/column-mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: parseInt(currentMappingClientId), mapping_name: currentMappingName, mappings: mappings, created_by: "admin" }) });
    if (response.ok) {
      showToast(`Mappings saved to "${currentMappingName}"`, "success");
      document.getElementById("exportTemplateBtnModal").classList.remove("hidden");
      await loadMappingNamesModal();
    } else { const error = await response.json(); showToast(error.error || "Error saving mappings", "error"); }
  } catch (err) { showToast("Error saving mappings: " + err.message, "error"); }
}

function cancelMappingModal() {
  document.getElementById("uploadColumnsAreaModal").classList.add("hidden");
  document.getElementById("mappingTableContainerModal").classList.add("hidden");
  document.getElementById("mappingExcelFileModal").value = "";
  if (document.getElementById("deleteMappingBtnModal")) document.getElementById("deleteMappingBtnModal").classList.add("hidden");
  if (document.getElementById("renameMappingBtnModal")) document.getElementById("renameMappingBtnModal").classList.add("hidden");
  const exportBtn = document.getElementById("exportTemplateBtnModal");
  if (exportBtn) exportBtn.classList.add("hidden");
  document.getElementById("noMappingSelectedModal").style.display = "block";
  document.getElementById("noMappingSelectedModal").innerText = "Select a mapping template or create a new one to begin mapping columns.";
  currentExcelColumns = [];
  currentMappingName = null;
  loadMappingNamesModal();
}

async function exportCurrentMappingTemplateModal() {
  if (!currentMappingName) { showToast("No mapping template selected", "error"); return; }
  try {
    const response = await fetch(`/api/column-mappings/${currentMappingClientId}?mappingName=${encodeURIComponent(currentMappingName)}`);
    const mappings = await response.json();
    if (mappings.length === 0) { showToast("No mappings found in this template", "error"); return; }
    const exportData = mappings.map(m => ({ "Excel Column": m.excel_column, "Target Field": m.target_field, "Field Type": m.is_custom_field ? "Custom Field" : "Standard Field" }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mapping Template");
    XLSX.writeFile(wb, `MappingTemplate_${currentMappingName}.xlsx`);
    showToast(`Template "${currentMappingName}" exported`, "success");
  } catch (err) { showToast("Error exporting template: " + err.message, "error"); }
}

function toggleInlineNewMapping() {
  const section = document.getElementById("inlineNewMappingSection");
  if (section.classList.contains("hidden")) {
    section.classList.remove("hidden");
    document.getElementById("newMappingNameInline").value = "";
    document.getElementById("newMappingNameInline").focus();
  } else section.classList.add("hidden");
}

async function createNewMappingInline() {
  const mappingName = document.getElementById("newMappingNameInline").value.trim();
  if (!mappingName) { showToast("Please enter a mapping name", "error"); return; }
  const existingResponse = await fetch(`/api/column-mappings/${currentMappingClientId}/names`);
  const existingMappings = await existingResponse.json();
  if (existingMappings.some(m => m.mapping_name === mappingName)) { showToast(`Mapping "${mappingName}" already exists`, "error"); return; }
  const createResponse = await fetch("/api/column-mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: parseInt(currentMappingClientId), mapping_name: mappingName, mappings: [], created_by: "admin" }) });
  if (!createResponse.ok) { const error = await createResponse.json(); showToast(error.error || "Error creating mapping", "error"); return; }
  showToast(`Mapping template "${mappingName}" created. Upload an Excel file to begin mapping.`, "info");
  toggleInlineNewMapping();
  currentExcelColumns = [];
  currentMappingsList = [];
  currentMappingName = mappingName;
  document.getElementById("mappingExcelFileModal").value = "";
  document.getElementById("uploadColumnsAreaModal").classList.remove("hidden");
  document.getElementById("mappingTableContainerModal").classList.add("hidden");
  document.getElementById("noMappingSelectedModal").style.display = "none";
  document.getElementById("deleteMappingBtnModal").classList.remove("hidden");
  document.getElementById("columnsStatusModal").innerHTML = '<p class="status-info">📋 New template created. Upload an Excel file to define column mappings.</p>';
  clearStatusMessage("columnsStatusModal");
  await loadMappingNamesModal();
  document.querySelectorAll("#mappingBadgesModal .mapping-badge").forEach(b => b.classList.remove("active"));
  const container = document.getElementById("mappingBadgesModal");
  container.innerHTML += `<span class="mapping-badge active unsaved" onclick="selectMappingModal('${escapeHtml(mappingName)}')">${escapeHtml(mappingName)}</span>`;
  document.getElementById("mappingSelectorModal").classList.remove("hidden");
  selectMappingModal(mappingName);
}

async function renameCurrentMappingInModal() {
  if (!currentMappingName) { showToast("No mapping selected", "error"); return; }
  const newName = prompt(`Rename mapping template "${currentMappingName}" to:`, currentMappingName);
  if (!newName || newName.trim() === "" || newName.trim() === currentMappingName) return;
  const cleanNewName = newName.trim();
  try {
    const existingResponse = await fetch(`/api/column-mappings/${currentMappingClientId}/names`);
    const existingMappings = await existingResponse.json();
    if (existingMappings.some(m => m.mapping_name.toLowerCase() === cleanNewName.toLowerCase())) { showToast(`A template named "${cleanNewName}" already exists.`, "error"); return; }
    showToast("Renaming...", "info");
    const createResponse = await fetch("/api/column-mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: parseInt(currentMappingClientId), mapping_name: cleanNewName, mappings: currentMappingsList, created_by: "admin" }) });
    if (createResponse.ok) {
      await fetch(`/api/column-mappings/${currentMappingClientId}/${currentMappingName}`, { method: "DELETE" });
      showToast(`Renamed to "${cleanNewName}"`, "success");
      currentMappingName = cleanNewName;
      await loadMappingNamesModal();
      selectMappingModal(cleanNewName);
      if (window.loadProjectMappingTemplates) window.loadProjectMappingTemplates();
    } else { const error = await createResponse.json(); showToast(error.error || "Error renaming mapping", "error"); }
  } catch (err) { showToast("Error during rename: " + err.message, "error"); }
}

async function deleteCurrentMappingInModal() {
  if (!currentMappingName) { showToast("No mapping selected", "error"); return; }
  if (!confirm(`Delete mapping "${currentMappingName}"? This cannot be undone.`)) return;
  try {
    const response = await fetch(`/api/column-mappings/${currentMappingClientId}/${currentMappingName}`, { method: "DELETE" });
    if (response.ok) {
      showToast(`Mapping "${currentMappingName}" deleted`, "success");
      currentMappingName = null;
      currentExcelColumns = [];
      currentMappingsList = [];
      document.getElementById("mappingExcelFileModal").value = "";
      document.getElementById("uploadColumnsAreaModal").classList.add("hidden");
      document.getElementById("mappingTableContainerModal").classList.add("hidden");
      document.getElementById("columnsStatusModal").innerHTML = "";
      await loadMappingNamesModal();
    } else { const error = await response.json(); showToast("Error: " + (error.error || "Could not delete"), "error"); }
  } catch (err) { showToast("Error deleting mapping: " + err.message, "error"); }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loadExcelBtnModal")?.addEventListener("click", () => document.getElementById("mappingExcelFileModal").click());
  document.getElementById("mappingExcelFileModal")?.addEventListener("change", async function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("excel", file);
    const statusDiv = document.getElementById("columnsStatusModal");
    showToast("📤 Loading columns...", "info");
    try {
      const response = await fetch("/api/get-excel-columns", { method: "POST", body: formData });
      const result = await response.json();
      if (response.ok) {
        currentExcelColumns = result.columns;
        currentSampleData = result.sampleData || {};
        statusDiv.innerHTML = `<p class="status-success">✅ Loaded ${result.columns.length} columns from "${escapeHtml(file.name)}" (${result.rowCount} rows)</p>`;
        document.getElementById("exportTemplateBtnModal").classList.add("hidden");
        renderMappingTableWithExistingModal();
        document.getElementById("mappingTableContainerModal").classList.remove("hidden");
      } else { showToast(`Error: ${escapeHtml(result.error)}`, "error"); statusDiv.innerHTML = ""; }
    } catch (err) { showToast(`Failed: ${escapeHtml(err.message)}`, "error"); statusDiv.innerHTML = ""; }
    e.target.value = "";
  });
  document.getElementById("toggleInlineNewMappingBtn")?.addEventListener("click", toggleInlineNewMapping);
  document.getElementById("createMappingInlineBtn")?.addEventListener("click", createNewMappingInline);
  document.getElementById("cancelInlineMappingBtn")?.addEventListener("click", toggleInlineNewMapping);
  document.getElementById("smartMatchBtn")?.addEventListener("click", runSmartMatch);
  document.getElementById("ignoreUnmappedBtn")?.addEventListener("click", ignoreUnmapped);
  document.getElementById("saveMappingBtn")?.addEventListener("click", saveMappingsModal);
  document.getElementById("cancelMappingBtn")?.addEventListener("click", cancelMappingModal);
  document.getElementById("deleteMappingBtnModal")?.addEventListener("click", deleteCurrentMappingInModal);
  document.getElementById("renameMappingBtnModal")?.addEventListener("click", renameCurrentMappingInModal);
  document.getElementById("exportTemplateBtnModal")?.addEventListener("click", exportCurrentMappingTemplateModal);
});

window.openMappingsModal = openMappingsModal;
window.closeMappingsModal = closeMappingsModal;
window.selectMappingModal = selectMappingModal;
window.updateMappingProgress = updateMappingProgress;
window.addCustomRowModal = addCustomRowModal;
window.loadMappingClientDropdownModal = loadMappingClientDropdownModal;
window.loadMappingNamesModal = loadMappingNamesModal;