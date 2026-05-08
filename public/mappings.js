// ==================== FIELD MAPPINGS MANAGEMENT ====================
console.log("=== MAPPINGS.JS LOADED ===");

// Note: Global variables are already declared in main.js
// Do NOT redeclare them here - just use them

async function loadMappingClientDropdownModal() {
  console.log("loadMappingClientDropdownModal called");

  const select = document.getElementById("mappingClientSelect");
  const newMappingBtn = document.getElementById("toggleInlineNewMappingBtn");

  if (!select) {
    console.error("mappingClientSelect not found!");
    return;
  }

  try {
    const response = await fetch("/api/clients");
    const clients = await response.json();
    const activeClients = clients.filter((c) => c.is_active === true);

    select.innerHTML = '<option value="">-- Select a Client --</option>';
    activeClients.forEach((client) => {
      const option = document.createElement("option");
      option.value = client.id;
      option.textContent = client.client_name;
      select.appendChild(option);
    });

    console.log("Dropdown populated with", select.options.length - 1, "clients");

    const clientSelect = document.getElementById("clientSelect");
    if (clientSelect && clientSelect.value) {
      currentMappingClientId = clientSelect.value;
      select.value = currentMappingClientId;
      console.log("Preselected client from projects tab:", currentMappingClientId);
    }

    select.onchange = function () {
      currentMappingClientId = select.value;
      console.log("Client changed to:", currentMappingClientId);

      if (newMappingBtn) {
        newMappingBtn.disabled = !currentMappingClientId;
      }

      if (currentMappingClientId) {
        loadMappingNamesModal();
      } else {
        resetMappingUIModal();
      }
    };

    if (select.onchange) select.onchange();

    if (currentMappingClientId && select.value) {
      loadMappingNamesModal();
    }
  } catch (err) {
    console.error("Error loading clients:", err);
    select.innerHTML = '<option value="">-- Error loading clients --</option>';
    if (window.showToast) showToast("Error loading clients: " + err.message, "error");
  }
}

async function loadMappingNamesModal() {
  if (!currentMappingClientId) {
    console.log("No client ID, skipping loadMappingNamesModal");
    return;
  }

  console.log("loadMappingNamesModal called for client:", currentMappingClientId);

  try {
    const response = await fetch(`/api/column-mappings/${currentMappingClientId}/names`);
    if (!response.ok) {
      console.error("Failed to load mapping names");
      return;
    }
    const mappings = await response.json();
    if (!Array.isArray(mappings)) {
      console.error("Invalid response format");
      return;
    }
    console.log("Mappings found:", mappings.length);

    const container = document.getElementById("mappingBadgesModal");
    const selectorDiv = document.getElementById("mappingSelectorModal");

    if (!container) return;

    if (mappings.length === 0) {
      container.innerHTML = "";
      if (selectorDiv) selectorDiv.classList.remove("hidden");

      // FIX: Check if elements exist before accessing classList
      const uploadArea = document.getElementById("uploadColumnsAreaModal");
      const tableContainer = document.getElementById("mappingTableContainerModal");
      const noMappingDiv = document.getElementById("noMappingSelectedModal");

      if (uploadArea) uploadArea.classList.add("hidden");
      if (tableContainer) tableContainer.classList.add("hidden");
      if (noMappingDiv) noMappingDiv.style.display = "block";
      return;
    }

    if (selectorDiv) selectorDiv.classList.remove("hidden");

    let savedMappingsList = [];
    try {
      const savedResponse = await fetch(`/api/column-mappings/${currentMappingClientId}`);
      savedMappingsList = await savedResponse.json();
    } catch (e) {}

    const mappingsWithContent = new Set(savedMappingsList.map((m) => m.mapping_name));

    container.innerHTML = mappings
      .map((m) => {
        const hasContent = mappingsWithContent.has(m.mapping_name);
        const isActive = currentMappingName === m.mapping_name;
        const isUnsaved = isActive && !hasContent;
        let badgeClass = "mapping-badge";
        if (isActive) badgeClass += " active";
        if (isUnsaved) badgeClass += " unsaved";
        return `<span class="${badgeClass}" onclick="selectMappingModal('${escapeHtml(m.mapping_name)}')">${escapeHtml(m.mapping_name)}</span>`;
      })
      .join("");
  } catch (err) {
    console.error("Error loading mapping names:", err);
  }
}

function resetMappingUIModal() {
  currentMappingName = null;
  const selectorDiv = document.getElementById("mappingSelectorModal");
  const uploadArea = document.getElementById("uploadColumnsAreaModal");
  const tableContainer = document.getElementById("mappingTableContainerModal");
  const noMappingDiv = document.getElementById("noMappingSelectedModal");
  const deleteBtn = document.getElementById("deleteMappingBtnModal");
  const renameBtn = document.getElementById("renameMappingBtnModal");

  if (selectorDiv) selectorDiv.classList.add("hidden");
  if (uploadArea) uploadArea.classList.add("hidden");
  if (tableContainer) tableContainer.classList.add("hidden");
  if (deleteBtn) deleteBtn.classList.add("hidden");
  if (renameBtn) renameBtn.classList.add("hidden");
  if (noMappingDiv) {
    noMappingDiv.style.display = "block";
    noMappingDiv.innerText = "Select a client to view or create mapping templates";
  }
}

async function selectMappingModal(mappingName) {
  console.log("selectMappingModal called:", mappingName);
  currentMappingName = mappingName;
  currentExcelColumns = [];
  currentMappingsList = [];

  document.getElementById("mappingExcelFileModal").value = "";

  const mappingContainer = document.getElementById("mappingTableContainerModal");
  const noMappingDiv = document.getElementById("noMappingSelectedModal");
  const uploadArea = document.getElementById("uploadColumnsAreaModal");

  if (mappingContainer) mappingContainer.classList.remove("hidden");
  if (noMappingDiv) noMappingDiv.style.display = "none";
  if (uploadArea) uploadArea.classList.remove("hidden");

  const deleteBtn = document.getElementById("deleteMappingBtnModal");
  const renameBtn = document.getElementById("renameMappingBtnModal");
  const exportBtn = document.getElementById("exportTemplateBtnModal");

  if (deleteBtn) deleteBtn.classList.remove("hidden");
  if (renameBtn) renameBtn.classList.remove("hidden");
  if (exportBtn) exportBtn.classList.remove("hidden");

  document.querySelectorAll("#mappingBadgesModal .mapping-badge").forEach((b) => {
    b.classList.remove("active", "unsaved");
    if (b.innerText === mappingName) {
      b.classList.add("active");
    }
  });

  try {
    const response = await fetch(`/api/column-mappings/${currentMappingClientId}?mappingName=${encodeURIComponent(mappingName)}`);
    const mappings = await response.json();
    currentMappingsList = mappings;

    if (mappings.length > 0) {
      currentExcelColumns = [...new Set(mappings.map((m) => m.excel_column))];
      showTemplatesStatus(`✅ Loaded ${currentExcelColumns.length} mapped columns from "${escapeHtml(mappingName)}"`, "success");
      renderMappingTableWithExistingModal();
      if (mappingContainer) mappingContainer.classList.remove("hidden");
    } else {
      const activeBadge = document.querySelector("#mappingBadgesModal .mapping-badge.active");
      if (activeBadge) activeBadge.classList.add("unsaved");
      if (mappingContainer) mappingContainer.classList.add("hidden");
      showTemplatesStatus(`📋 New template "${escapeHtml(mappingName)}" - Click 📂 to load Excel`, "info");
      if (window.showToast) showToast("No mappings defined yet. Please click 📂 Load Excel to start.", "info");
    }
  } catch (err) {
    console.error("Error loading mappings:", err);
    showTemplatesStatus(`Error: ${escapeHtml(err.message)}`, "error");
  }
}

function renderMappingTableWithExistingModal() {
  const tbody = document.getElementById("mappingTableBodyModal");
  if (!tbody) return;

  const definitions = window.mappingDefinitions || [];

  const existingMap = {};
  currentMappingsList.forEach((m) => {
    existingMap[m.excel_column] = m.target_field;
  });

  if (currentExcelColumns.length === 0) {
    tbody.innerHTML =
      '</table><td colspan="5" style="text-align:center; padding: 40px;">📂 No columns loaded. Click the 📂 button to upload an Excel file.奠基</tr>';
    return;
  }

  tbody.innerHTML = currentExcelColumns
    .map((col) => {
      const optionsHtml = definitions
        .map((def) => {
          const isReq = window.REQUIRED_FIELDS && window.REQUIRED_FIELDS.includes(def.target_field) ? " *" : "";
          const isSel = existingMap[col] === def.target_field ? "selected" : "";
          return `<option value="${def.target_field}" ${isSel}>${escapeHtml(def.display_name)}${isReq}</option>`;
        })
        .join("");

      return `
      <tr>
        <td style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;" title="${escapeHtml(col)}">
          <strong>${escapeHtml(col)}</strong>
        </td>
        <td style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;" title="${escapeHtml(String(currentSampleData[col] || "—"))}">
          ${escapeHtml(String(currentSampleData[col] || "—").substring(0, 40))}
        </td>
        <td style="text-align: center;">➡️</td>
        <td>
          <select class="mapping-select" id="map_modal_${col.replace(/[^a-zA-Z0-9]/g, "_")}" data-column="${escapeHtml(col)}" onchange="updateMappingProgress()">
            <option value="">-- Select Field --</option>
            ${optionsHtml}
            <option value="ignore" ${existingMap[col] === "ignore" ? "selected" : ""}>🚫 Ignore</option>
          </select>
        </td>
        <td style="text-align: center;">
          <button class="btn-sm btn-secondary" onclick="addCustomRowModal('${escapeHtml(col)}')" style="padding: 4px 8px; font-size: 12px; white-space: nowrap;">✏️ Custom</button>
        </td>
      </tr>
    `;
    })
    .join("");

  updateMappingProgress();
}

function openMappingsModal() {
  console.log("openMappingsModal called");
  const modal = document.getElementById("mappingsModal");
  if (!modal) {
    console.error("Modal not found!");
    return;
  }
  modal.style.display = "block";
  loadMappingClientDropdownModal();
}

// Update closeMappingsModal function:
function closeMappingsModal() {
  console.log("closeMappingsModal called");
  const modal = document.getElementById("mappingsModal");
  if (modal) {
    modal.style.display = "none";
  }
  resetMappingUIModal();

  // Refresh mapping templates dropdown in projects tab
  if (window.loadProjectMappingTemplates) {
    window.loadProjectMappingTemplates();
  }
}

function toggleInlineNewMapping() {
  console.log("toggleInlineNewMapping called");
  const section = document.getElementById("inlineNewMappingSection");
  if (section) {
    if (section.classList.contains("hidden")) {
      section.classList.remove("hidden");
      document.getElementById("newMappingNameInline").value = "";
      document.getElementById("newMappingNameInline").focus();
    } else {
      section.classList.add("hidden");
    }
  }
}

// Helper function to show status in templates bar
function showTemplatesStatus(message, type = "success") {
  const statusDiv = document.getElementById("templatesInlineStatus");
  if (statusDiv) {
    statusDiv.innerHTML = message;
    statusDiv.className = `templates-status ${type}`;
    setTimeout(() => {
      if (statusDiv) statusDiv.innerHTML = "";
    }, 8000);
  }
}

async function createNewMappingInline() {
  console.log("createNewMappingInline called");

  const mappingName = document.getElementById("newMappingNameInline").value.trim();

  if (!mappingName) {
    if (window.showToast) showToast("Please enter a mapping name", "error");
    return;
  }

  if (!currentMappingClientId) {
    if (window.showToast) showToast("Please select a client first", "error");
    return;
  }

  try {
    // Check if mapping name already exists (check all templates, including empty ones)
    const checkResponse = await fetch(`/api/column-mappings/${currentMappingClientId}/names`);
    let existingMappings = [];
    if (checkResponse.ok) {
      const data = await checkResponse.json();
      if (Array.isArray(data)) existingMappings = data;
    }

    if (existingMappings.some((m) => m.mapping_name === mappingName)) {
      if (window.showToast) showToast(`Mapping "${mappingName}" already exists`, "error");
      return;
    }

    // Create new mapping template
    const createResponse = await fetch("/api/column-mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: parseInt(currentMappingClientId),
        mapping_name: mappingName,
        mappings: [],
        created_by: "admin",
      }),
    });

    if (createResponse.ok) {
      if (window.showToast) showToast(`Template "${mappingName}" created!`, "success");

      // Hide the inline form
      toggleInlineNewMapping();

      // Set current mapping name
      currentMappingName = mappingName;
      currentExcelColumns = [];
      currentMappingsList = [];

      // Refresh badges from server
      await loadMappingNamesModal();

      // MANUALLY ADD THE BADGE IF SERVER DIDN'T RETURN IT
      const container = document.getElementById("mappingBadgesModal");
      const exists = container && Array.from(container.querySelectorAll(".mapping-badge")).some((b) => b.textContent === mappingName);

      if (container && !exists) {
        console.log("Manually adding badge for:", mappingName);
        const badge = document.createElement("span");
        badge.className = "mapping-badge active unsaved";
        badge.textContent = mappingName;
        badge.onclick = () => selectMappingModal(mappingName);
        container.appendChild(badge);
      }

      // Show the templates section
      const selectorDiv = document.getElementById("mappingSelectorModal");
      if (selectorDiv) selectorDiv.classList.remove("hidden");

      // Open the mapping view for this new template
      await selectMappingModal(mappingName);
    } else {
      const error = await createResponse.json();
      if (window.showToast) showToast(error.error || "Error creating mapping", "error");
    }
  } catch (err) {
    console.error("Error creating mapping:", err);
    if (window.showToast) showToast("Error creating mapping: " + err.message, "error");
  }
}

function cancelNewMapping() {
  toggleInlineNewMapping();
}

function updateMappingProgress() {
  const selects = document.querySelectorAll(".mapping-select");
  if (selects.length === 0) return;

  let mappedCount = 0;
  selects.forEach((sel) => {
    const row = sel.closest("tr");
    if (sel.value && sel.value !== "") {
      mappedCount++;
      if (row) row.classList.add("mapped-row");
    } else {
      if (row) row.classList.remove("mapped-row");
    }
  });

  const progressSpan = document.getElementById("mappingProgressText");
  if (progressSpan) {
    progressSpan.innerText = `Mapped: ${mappedCount} / ${selects.length}`;
  }

  const percentage = selects.length > 0 ? Math.round((mappedCount / selects.length) * 100) : 0;
  const progressFill = document.getElementById("mappingProgressFill");
  const percentageSpan = document.getElementById("progressPercentage");

  if (progressFill) {
    progressFill.style.width = `${percentage}%`;
  }
  if (percentageSpan) {
    percentageSpan.innerText = `${percentage}%`;
  }

  const saveBtn = document.getElementById("saveMappingBtn");
  if (saveBtn) {
    saveBtn.disabled = mappedCount !== selects.length;
  }
}

function ignoreUnmapped() {
  const selects = document.querySelectorAll(".mapping-select");
  selects.forEach((sel) => {
    if (!sel.value || sel.value === "") {
      sel.value = "ignore";
    }
  });
  updateMappingProgress();
}

function setupSmartMatchDropdown() {
  const smartMatchBtn = document.getElementById("smartMatchBtn");
  const dropdown = document.getElementById("smartMatchDropdown");

  if (!smartMatchBtn) return;

  smartMatchBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
  });

  document.addEventListener("click", () => {
    dropdown.classList.add("hidden");
  });

  const levels = [
    { id: "smartMatchLevel1", threshold: 60, name: "Cautious" },
    { id: "smartMatchLevel2", threshold: 52, name: "Moderate" },
    { id: "smartMatchLevel3", threshold: 44, name: "Balanced" },
    { id: "smartMatchLevel4", threshold: 36, name: "Aggressive" },
    { id: "smartMatchLevel5", threshold: 25, name: "Maximum" },
  ];

  levels.forEach((level) => {
    const btn = document.getElementById(level.id);
    if (btn) {
      btn.addEventListener("click", () => {
        dropdown.classList.add("hidden");
        runSmartMatchWithThreshold(level.threshold, level.name);
      });
    }
  });

  const resetBtn = document.getElementById("resetSmartMatchBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      dropdown.classList.add("hidden");
      window.smartMatchAttempts = 0;
      if (window.showToast) showToast("Smart Match reset to cautious mode", "info");
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupSmartMatchDropdown();
});

let smartMatchAttempts = 0;

async function runSmartMatch() {
  console.log("runSmartMatch called - Progressive mode");

  const selects = document.querySelectorAll(".mapping-select");
  if (selects.length === 0) return;

  smartMatchAttempts++;

  const unmappedColumns = [];
  const sampleDataMap = {};
  const selectMap = {};

  selects.forEach((sel) => {
    if (!sel.value || sel.value === "") {
      const colName = sel.getAttribute("data-column");
      unmappedColumns.push(colName);
      sampleDataMap[colName] = currentSampleData[colName] || "";
      selectMap[colName] = sel;
    }
  });

  if (unmappedColumns.length === 0) {
    showToast("All columns are already mapped!", "info");
    smartMatchAttempts = 0;
    return;
  }

  let aggressivenessLevel = Math.min(smartMatchAttempts, 5);
  let threshold = 60 - aggressivenessLevel * 8;
  threshold = Math.max(threshold, 25);

  let levelNames = {
    1: "Cautious (60% threshold)",
    2: "Moderate (52% threshold)",
    3: "Balanced (44% threshold)",
    4: "Aggressive (36% threshold)",
    5: "Very Aggressive (28% threshold)",
    6: "Maximum (25% threshold)",
  };
  let currentLevel = levelNames[aggressivenessLevel + 1] || "Maximum (25% threshold)";

  showToast(`🔍 Smart Match - Attempt ${smartMatchAttempts}: ${currentLevel}`, "info");

  try {
    const response = await fetch("/api/smart-match/batch-progressive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        columns: unmappedColumns,
        clientId: currentMappingClientId,
        sampleDataMap: sampleDataMap,
        threshold: threshold,
        aggressivenessLevel: aggressivenessLevel,
      }),
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const results = await response.json();
    let matchCount = 0;

    for (const [columnName, matchedField] of Object.entries(results)) {
      if (matchedField && matchedField !== "ignore" && selectMap[columnName]) {
        selectMap[columnName].value = matchedField;
        matchCount++;
        console.log(`✨ Smart matched (Level ${aggressivenessLevel + 1}): "${columnName}" → ${matchedField}`);
      }
    }

    updateMappingProgress();

    if (matchCount > 0) {
      if (unmappedColumns.length - matchCount > 0) {
        showToast(`✨ Found ${matchCount} matches. Click Smart Match again for more (${unmappedColumns.length - matchCount} remaining)`, "success");
      } else {
        showToast(`✨ Successfully matched all ${matchCount} columns!`, "success");
        smartMatchAttempts = 0;
      }
    } else {
      if (aggressivenessLevel >= 4) {
        showToast(`No more matches found. Please map remaining columns manually.`, "info");
        smartMatchAttempts = 0;
      } else {
        showToast(`No matches at ${currentLevel}. Click Smart Match again for lower threshold.`, "info");
      }
    }
  } catch (err) {
    console.error("Smart match error:", err);
    showToast("Error during smart match: " + err.message, "error");
    smartMatchAttempts = 0;
  }
}

function resetSmartMatch() {
  smartMatchAttempts = 0;
  showToast("Smart Match reset to cautious mode", "info");
}

function addSmartMatchResetButton() {
  const smartMatchBtn = document.getElementById("smartMatchBtn");
  if (smartMatchBtn && !document.getElementById("resetSmartMatchBtn")) {
    const resetBtn = document.createElement("button");
    resetBtn.id = "resetSmartMatchBtn";
    resetBtn.className = "btn-secondary";
    resetBtn.style.marginLeft = "8px";
    resetBtn.style.padding = "6px 12px";
    resetBtn.style.fontSize = "12px";
    resetBtn.innerHTML = "🔄 Reset";
    resetBtn.title = "Reset smart match to cautious mode";
    resetBtn.onclick = resetSmartMatch;
    smartMatchBtn.parentNode.appendChild(resetBtn);
  }
}

const originalOpenMappingsModal = window.openMappingsModal;
window.openMappingsModal = function () {
  smartMatchAttempts = 0;
  if (originalOpenMappingsModal) originalOpenMappingsModal();
  setTimeout(addSmartMatchResetButton, 500);
};

function addCustomRowModal(columnName) {
  const customField = prompt(`Enter custom field name for "${columnName}":`, columnName);
  if (customField) {
    const selectId = `map_modal_${columnName.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const select = document.getElementById(selectId);
    if (select) {
      if (!Array.from(select.options).some((opt) => opt.value === `custom_${customField}`)) {
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
  if (!currentMappingName) {
    if (window.showToast) showToast("No mapping selected", "error");
    return;
  }

  const mappings = [];
  for (const col of currentExcelColumns) {
    const select = document.getElementById(`map_modal_${col.replace(/[^a-zA-Z0-9]/g, "_")}`);
    if (select && select.value && select.value !== "") {
      mappings.push({
        excel_column: col,
        target_field: select.value,
        is_custom_field: select.value.startsWith("custom_"),
      });
    }
  }

  if (mappings.length === 0) {
    if (window.showToast) showToast("No mappings to save", "error");
    return;
  }

  const usedFields = mappings.map((m) => m.target_field);
  const missingReq = (window.REQUIRED_FIELDS || ["customer_name"]).filter((rf) => !usedFields.includes(rf));
  if (missingReq.length > 0) {
    if (window.showToast) showToast(`Missing required mappings: ${missingReq.join(", ")}.`, "error");
    return;
  }

  try {
    const response = await fetch("/api/column-mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: parseInt(currentMappingClientId),
        mapping_name: currentMappingName,
        mappings: mappings,
        created_by: "admin",
      }),
    });

    if (response.ok) {
      showTemplatesStatus(`✅ Mappings saved to "${escapeHtml(currentMappingName)}"`, "success");
      if (window.showToast) showToast(`Mappings saved to "${currentMappingName}"`, "success");
      await loadMappingNamesModal();

      const activeBadge = document.querySelector("#mappingBadgesModal .mapping-badge.active");
      if (activeBadge) activeBadge.classList.remove("unsaved");
    } else {
      const error = await response.json();
      showTemplatesStatus(`Error: ${escapeHtml(error.error || "Error saving mappings")}`, "error");
      if (window.showToast) showToast(error.error || "Error saving mappings", "error");
    }
  } catch (err) {
    showTemplatesStatus(`Error: ${escapeHtml(err.message)}`, "error");
    if (window.showToast) showToast("Error saving mappings: " + err.message, "error");
  }
}

function cancelMappingModal() {
  document.getElementById("uploadColumnsAreaModal").classList.add("hidden");
  document.getElementById("mappingTableContainerModal").classList.add("hidden");
  document.getElementById("mappingExcelFileModal").value = "";
  currentExcelColumns = [];
  currentMappingName = null;
  loadMappingNamesModal();
}

async function deleteCurrentMappingInModal() {
  console.log("deleteCurrentMappingInModal called");

  if (!currentMappingName) {
    if (window.showToast) showToast("No mapping template selected", "error");
    return;
  }

  if (!confirm(`Are you sure you want to delete mapping template "${currentMappingName}"? This action cannot be undone.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/column-mappings/${currentMappingClientId}/${currentMappingName}`, {
      method: "DELETE",
    });

    if (response.ok) {
      if (window.showToast) showToast(`Mapping template "${currentMappingName}" deleted successfully`, "success");

      currentMappingName = null;
      currentExcelColumns = [];
      currentMappingsList = [];

      const excelInput = document.getElementById("mappingExcelFileModal");
      if (excelInput) excelInput.value = "";

      const uploadArea = document.getElementById("uploadColumnsAreaModal");
      const tableContainer = document.getElementById("mappingTableContainerModal");
      const columnsStatus = document.getElementById("columnsStatusModal");

      if (uploadArea) uploadArea.classList.add("hidden");
      if (tableContainer) tableContainer.classList.add("hidden");
      if (columnsStatus) columnsStatus.innerHTML = "";

      const noMappingDiv = document.getElementById("noMappingSelectedModal");
      if (noMappingDiv) {
        noMappingDiv.style.display = "block";
        noMappingDiv.innerText = "Select a mapping template or create a new one to begin mapping columns.";
      }

      const deleteBtn = document.getElementById("deleteMappingBtnModal");
      const renameBtn = document.getElementById("renameMappingBtnModal");

      if (deleteBtn) deleteBtn.classList.add("hidden");
      if (renameBtn) renameBtn.classList.add("hidden");

      await loadMappingNamesModal();
    } else {
      const error = await response.json();
      if (window.showToast) showToast(error.error || "Error deleting mapping template", "error");
    }
  } catch (err) {
    console.error("Error during delete:", err);
    if (window.showToast) showToast("Error deleting mapping: " + err.message, "error");
  }
}

async function renameCurrentMappingInModal() {
  console.log("renameCurrentMappingInModal called");

  if (!currentMappingName) {
    if (window.showToast) showToast("No mapping template selected", "error");
    return;
  }

  const newName = prompt(`Rename mapping template "${currentMappingName}" to:`, currentMappingName);
  if (!newName || newName.trim() === "" || newName.trim() === currentMappingName) {
    return;
  }

  const cleanNewName = newName.trim();

  try {
    const existingResponse = await fetch(`/api/column-mappings/${currentMappingClientId}/names`);
    const existingMappings = await existingResponse.json();

    if (existingMappings.some((m) => m.mapping_name.toLowerCase() === cleanNewName.toLowerCase())) {
      if (window.showToast) showToast(`A template named "${cleanNewName}" already exists.`, "error");
      return;
    }

    const getResponse = await fetch(`/api/column-mappings/${currentMappingClientId}?mappingName=${encodeURIComponent(currentMappingName)}`);
    const currentMappings = await getResponse.json();

    const createResponse = await fetch("/api/column-mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: parseInt(currentMappingClientId),
        mapping_name: cleanNewName,
        mappings: currentMappings,
        created_by: "admin",
      }),
    });

    if (createResponse.ok) {
      await fetch(`/api/column-mappings/${currentMappingClientId}/${currentMappingName}`, { method: "DELETE" });

      if (window.showToast) showToast(`Renamed to "${cleanNewName}"`, "success");

      currentMappingName = cleanNewName;
      await loadMappingNamesModal();
      await selectMappingModal(cleanNewName);
    } else {
      const error = await createResponse.json();
      if (window.showToast) showToast(error.error || "Error renaming mapping", "error");
    }
  } catch (err) {
    console.error("Error during rename:", err);
    if (window.showToast) showToast("Error during rename: " + err.message, "error");
  }
}

async function exportCurrentMappingTemplateModal() {
  if (!currentMappingName) {
    if (window.showToast) showToast("No mapping template selected", "error");
    return;
  }

  try {
    const response = await fetch(`/api/column-mappings/${currentMappingClientId}?mappingName=${encodeURIComponent(currentMappingName)}`);
    const mappings = await response.json();

    if (mappings.length === 0) {
      if (window.showToast) showToast("No mappings found in this template", "error");
      return;
    }

    const exportData = mappings.map((m) => ({
      "Excel Column": m.excel_column,
      "Target Field": m.target_field,
      "Field Type": m.is_custom_field ? "Custom Field" : "Standard Field",
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mapping Template");
    XLSX.writeFile(wb, `MappingTemplate_${currentMappingName}.xlsx`);
    if (window.showToast) showToast(`Template "${currentMappingName}" exported`, "success");
  } catch (err) {
    if (window.showToast) showToast("Error exporting template: " + err.message, "error");
  }
}

function setupFileUpload() {
  const loadExcelBtn = document.getElementById("loadExcelBtnModal");
  const excelFile = document.getElementById("mappingExcelFileModal");

  if (loadExcelBtn && excelFile) {
    loadExcelBtn.onclick = () => excelFile.click();
    excelFile.onchange = async function (e) {
      const file = e.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append("excel", file);
      showTemplatesStatus("📤 Loading columns...", "info");

      try {
        const response = await fetch("/api/get-excel-columns", { method: "POST", body: formData });
        const result = await response.json();

        if (response.ok) {
          currentExcelColumns = result.columns;
          currentSampleData = result.sampleData || {};

          window.currentExcelColumns = currentExcelColumns;
          window.currentSampleData = currentSampleData;

          showTemplatesStatus(`✅ Loaded ${result.columns.length} columns from "${escapeHtml(file.name)}" (${result.rowCount} rows)`, "success");
          renderMappingTableWithExistingModal();
          document.getElementById("mappingTableContainerModal").classList.remove("hidden");
          if (window.showToast) showToast(`Loaded ${result.columns.length} columns. Click "Smart Match" to auto-map!`, "success");
        } else {
          showTemplatesStatus(`Error: ${escapeHtml(result.error)}`, "error");
        }
      } catch (err) {
        showTemplatesStatus(`Error: ${escapeHtml(err.message)}`, "error");
      }
      e.target.value = "";
    };
  }
}

// Export to window
window.openMappingsModal = openMappingsModal;
window.closeMappingsModal = closeMappingsModal;
window.loadMappingClientDropdownModal = loadMappingClientDropdownModal;
window.loadMappingNamesModal = loadMappingNamesModal;
window.selectMappingModal = selectMappingModal;
window.toggleInlineNewMapping = toggleInlineNewMapping;
window.createNewMappingInline = createNewMappingInline;
window.cancelNewMapping = cancelNewMapping;
window.updateMappingProgress = updateMappingProgress;
window.ignoreUnmapped = ignoreUnmapped;
window.runSmartMatch = runSmartMatch;
window.addCustomRowModal = addCustomRowModal;
window.saveMappingsModal = saveMappingsModal;
window.cancelMappingModal = cancelMappingModal;
window.deleteCurrentMappingInModal = deleteCurrentMappingInModal;
window.renameCurrentMappingInModal = renameCurrentMappingInModal;
window.exportCurrentMappingTemplateModal = exportCurrentMappingTemplateModal;

document.addEventListener("DOMContentLoaded", function () {
  console.log("DOM ready - initializing mappings module");

  loadMappingDefinitions();
  setupFileUpload();

  const manageBtn = document.getElementById("manageMappingsBtn");
  if (manageBtn) {
    manageBtn.addEventListener("click", function (e) {
      e.preventDefault();
      console.log("manageMappingsBtn clicked");
      openMappingsModal();
    });
  }

  const newMappingBtn = document.getElementById("toggleInlineNewMappingBtn");
  if (newMappingBtn) {
    newMappingBtn.onclick = () => toggleInlineNewMapping();
  }

  const createBtn = document.getElementById("createMappingInlineBtn");
  if (createBtn) {
    createBtn.onclick = () => createNewMappingInline();
  }

  const cancelBtn = document.getElementById("cancelInlineMappingBtn");
  if (cancelBtn) {
    cancelBtn.onclick = () => cancelNewMapping();
  }

  const renameBtn = document.getElementById("renameMappingBtnModal");
  if (renameBtn) {
    renameBtn.onclick = (e) => {
      e.preventDefault();
      renameCurrentMappingInModal();
    };
  }

  const deleteBtn = document.getElementById("deleteMappingBtnModal");
  if (deleteBtn) {
    deleteBtn.onclick = (e) => {
      e.preventDefault();
      deleteCurrentMappingInModal();
    };
  }

  const exportBtn = document.getElementById("exportTemplateBtnModal");
  if (exportBtn) {
    exportBtn.onclick = () => exportCurrentMappingTemplateModal();
  }

  const closeSpan = document.querySelector("#mappingsModal .close");
  if (closeSpan) {
    closeSpan.onclick = () => closeMappingsModal();
  }

  const saveBtn = document.getElementById("saveMappingBtn");
  if (saveBtn) {
    saveBtn.onclick = () => {
      saveMappingsModal();
      document.getElementById("mappingTableContainerModal").classList.add("hidden");
      document.getElementById("uploadColumnsAreaModal").classList.add("hidden");
      document.getElementById("noMappingSelectedModal").style.display = "block";
      currentMappingName = null;
      loadMappingNamesModal();
    };
  }

  const cancelMappingBtn = document.getElementById("cancelMappingBtn");
  if (cancelMappingBtn) {
    cancelMappingBtn.onclick = () => {
      document.getElementById("mappingTableContainerModal").classList.add("hidden");
      document.getElementById("uploadColumnsAreaModal").classList.add("hidden");
      document.getElementById("noMappingSelectedModal").style.display = "block";
      currentMappingName = null;
      loadMappingNamesModal();
    };
  }

  const closeModalBtn = document.getElementById("closeMappingModalBtn");
  if (closeModalBtn) {
    closeModalBtn.onclick = () => {
      closeMappingsModal();
    };
  }

  const smartBtn = document.getElementById("smartMatchBtn");
  if (smartBtn) {
    smartBtn.onclick = () => runSmartMatch();
  }

  const ignoreBtn = document.getElementById("ignoreUnmappedBtn");
  if (ignoreBtn) {
    ignoreBtn.onclick = () => ignoreUnmapped();
  }
});
