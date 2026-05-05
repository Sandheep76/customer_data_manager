// ==================== GLOBAL STATE VARIABLES ====================
let currentClientId = null;
let showAllClients = false;
let showAllAssessTypes = false;
let currentAssessTypeClientId = null;
let statusTimeout = null;
let allProjects = [];
let currentPage = 1;
let itemsPerPage = 15;
let totalPages = 1;
let allClientsData = [];
let currentClientPage = 1;
let totalClientPages = 1;
let allAssessTypesData = [];
let currentAssessPage = 1;
let totalAssessPages = 1;
let mappingDefinitions = [];
let currentMappingClientId = null;
let currentMappingName = null;
let currentExcelColumns = [];
let currentMappingsList = [];
let currentSampleData = {};
let isEditMode = false;

// ==================== AUTO-MAPPING DICTIONARY ====================
const REQUIRED_FIELDS = ["customer_name"];
const AUTO_MAP_DICT = {
  "project name": "project_name",
  "job name": "project_name",
  "project number": "project_id",
  "project id": "project_id",
  "ci number": "project_id",
  customer: "customer_name",
  "customer name": "customer_name",
  client: "customer_name",
  type: "project_type",
  "project type": "project_type",
  address: "address",
  city: "city",
  state: "state",
  zip: "zip",
  "job address": "job_address",
  "job city": "job_city",
  "job state": "job_state",
  contractor: "contractor_name",
  "contractor phone": "contractor_phone",
  "assess type": "assess_type",
  assessment: "assess_type",
};

// ==================== UTILITY FUNCTIONS ====================
function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = "success") {
  let toastContainer = document.getElementById("toast-container");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toast-container";
    document.body.appendChild(toastContainer);
  }
  let bgColor = "#28a745";
  if (type === "error") bgColor = "#dc3545";
  if (type === "info") bgColor = "#17a2b8";
  if (type === "warning") bgColor = "#ffc107";
  const toast = document.createElement("div");
  toast.style.cssText = `background: ${bgColor}; color: ${type === "warning" ? "#333" : "white"}; padding: 10px 16px; border-radius: 8px; margin-top: 8px; font-size: 13px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); animation: slideIn 0.3s ease; cursor: pointer;`;
  const icon = type === "error" ? "❌" : type === "info" ? "ℹ️" : type === "warning" ? "⚠️" : "✅";
  toast.textContent = `${icon} ${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease";
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3000);
  toast.onclick = () => {
    toast.style.animation = "slideOut 0.3s ease";
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  };
}

function clearStatusMessage(elementId) {
  if (statusTimeout) clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => {
    const element = document.getElementById(elementId);
    if (element) element.innerHTML = "";
  }, 5000);
}

function attemptAutoMap(excelCol) {
  const cleanCol = excelCol
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
  if (AUTO_MAP_DICT[cleanCol]) return AUTO_MAP_DICT[cleanCol];
  for (const [key, val] of Object.entries(AUTO_MAP_DICT)) {
    if (cleanCol.includes(key) || key.includes(cleanCol)) return val;
  }
  return "";
}

function switchMainTab(tab) {
  const tabs = document.querySelectorAll(".main-tab");
  tabs.forEach((btn) => btn.classList.remove("active"));
  document.querySelectorAll(".tab-content-panel").forEach((panel) => panel.classList.remove("active"));

  if (tab === "clients") {
    tabs[0].classList.add("active");
    document.getElementById("clientsTab").classList.add("active");
    if (window.loadClientsList) window.loadClientsList(showAllClients);
  } else if (tab === "assessTypes") {
    tabs[1].classList.add("active");
    document.getElementById("assessTypesTab").classList.add("active");
    if (window.loadAssessTypeClientDropdown) window.loadAssessTypeClientDropdown();
  } else {
    tabs[2].classList.add("active");
    document.getElementById("projectsTab").classList.add("active");
    if (window.loadClientDropdown) window.loadClientDropdown();
  }
}

function toggleAll(source, className) {
  document.querySelectorAll(`.${className}`).forEach((cb) => (cb.checked = source.checked));
}

async function loadMappingDefinitions() {
  try {
    const response = await fetch("/api/mapping-definitions");
    mappingDefinitions = await response.json();
    console.log("Mapping definitions loaded:", mappingDefinitions.length);
  } catch (err) {
    console.error("Error loading mapping definitions:", err);
  }
}

function initApp() {
  loadMappingDefinitions();
  if (window.loadClientsList) window.loadClientsList(false);
  if (window.loadClientDropdown) window.loadClientDropdown();
  if (window.loadAssessTypeClientDropdown) window.loadAssessTypeClientDropdown();

  document.querySelectorAll(".main-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchMainTab(btn.dataset.tab));
  });

  document.querySelectorAll(".close").forEach((closeBtn) => {
    closeBtn.addEventListener("click", () => {
      const modal = closeBtn.closest(".modal");
      if (modal && modal.id === "mappingsModal" && window.closeMappingsModal) window.closeMappingsModal();
      else if (modal && modal.id === "clientModal" && window.closeClientModal) window.closeClientModal();
      else if (modal && modal.id === "assessTypeModal" && window.closeAssessTypeModal) window.closeAssessTypeModal();
      else if (modal && modal.id === "projectModal" && window.closeProjectModal) window.closeProjectModal();
      else if (modal) modal.style.display = "none";
    });
  });
}

// Export to window
window.initApp = initApp;
window.escapeHtml = escapeHtml;
window.showToast = showToast;
window.clearStatusMessage = clearStatusMessage;
window.attemptAutoMap = attemptAutoMap;
window.switchMainTab = switchMainTab;
window.toggleAll = toggleAll;
window.REQUIRED_FIELDS = REQUIRED_FIELDS;
window.AUTO_MAP_DICT = AUTO_MAP_DICT;
window.mappingDefinitions = mappingDefinitions;
window.currentMappingClientId = currentMappingClientId;
window.currentMappingName = currentMappingName;
window.currentExcelColumns = currentExcelColumns;
window.currentMappingsList = currentMappingsList;
window.currentSampleData = currentSampleData;
window.isEditMode = isEditMode;
