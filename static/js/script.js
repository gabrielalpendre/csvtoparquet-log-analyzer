let currentSessionId = localStorage.getItem('last_session_id') || "";
let currentFilename = "";
let allColumns = [];
let columnOptions = {};
let columnTypes = {};
let currentPage = 1;
let sortState = { col: null, dir: 'asc' };
let currentAnalyzedCol = null;

// --- COLUMN SPLIT STATE ---
const splitState = {};
// splitState["columnName"] = {
//   delimiter: string,
//   generatedCols: string[],
//   maxParts: number
// }
let effectiveColumns = [];
let currentRows = [];

// --- CONTEXT MENU ---

/**
 * Shows a context menu at the specified position.
 * @param {MouseEvent} event - The right-click event
 * @param {Array<{ label: string, action: () => void }>} items - Menu items
 */
function showContextMenu(event, items) {
  event.preventDefault();

  const menu = document.getElementById('columnContextMenu');
  if (!menu) return;

  // Clear existing items and populate dynamically
  menu.innerHTML = '';
  items.forEach(item => {
    const menuItem = document.createElement('div');
    menuItem.className = 'context-menu-item';
    menuItem.innerHTML = item.label;
    menuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideContextMenu();
      item.action();
    });
    menu.appendChild(menuItem);
  });

  // Position at mouse coordinates
  let x = event.clientX;
  let y = event.clientY;

  // Temporarily show to measure dimensions
  menu.style.display = 'block';
  menu.style.visibility = 'hidden';

  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Adjust if near viewport edges
  if (x + menuWidth > viewportWidth) {
    x = viewportWidth - menuWidth - 5;
  }
  if (y + menuHeight > viewportHeight) {
    y = viewportHeight - menuHeight - 5;
  }

  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.style.visibility = '';
}

/**
 * Hides any visible context menu.
 */
function hideContextMenu() {
  const menu = document.getElementById('columnContextMenu');
  if (menu) {
    menu.style.display = 'none';
  }
}

// Document-level event listeners for context menu dismissal
document.addEventListener('click', () => {
  hideContextMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideContextMenu();
  }
});

window.addEventListener('scroll', () => {
  hideContextMenu();
}, true);

const TYPE_ICONS = {
    number: 'bi-123',
    date: 'bi-calendar',
    currency: 'bi-currency-dollar',
    boolean: 'bi-toggle-on',
    percentage: 'bi-percent',
    text: 'bi-fonts'
};

// --- COLUMN SPLIT FUNCTIONS ---

/**
 * Validates that a delimiter is between 1 and 10 characters.
 * @param {string} delimiter - The delimiter to validate
 * @returns {boolean} true if valid, false otherwise
 */
function validateDelimiter(delimiter) {
  if (typeof delimiter !== 'string') return false;
  return delimiter.length >= 1 && delimiter.length <= 10;
}

/**
 * Performs the split operation on current data.
 * @param {string} col - Source column name
 * @param {string} delimiter - Delimiter string (1-10 chars)
 * @returns {{ success: boolean, message?: string }}
 */
function performSplit(col, delimiter) {
  if (!validateDelimiter(delimiter)) {
    return { success: false, message: "Delimiter must be between 1 and 10 characters." };
  }

  // Handle re-split: remove previous split columns if this column was already split
  if (splitState[col]) {
    const prevCols = splitState[col].generatedCols;
    effectiveColumns = effectiveColumns.filter(c => !prevCols.includes(c));
    // Clean row data from previous split
    currentRows.forEach(row => {
      prevCols.forEach(gc => { delete row[gc]; });
    });
    delete splitState[col];
  }

  // Determine max parts across all rows
  let maxParts = 0;
  currentRows.forEach(row => {
    const val = row[col] != null ? String(row[col]) : "";
    const parts = val.split(delimiter);
    if (parts.length > maxParts) maxParts = parts.length;
  });

  // Cap at 20
  maxParts = Math.min(maxParts, 20);

  // If delimiter not found in any row (maxParts <= 1), no split needed
  if (maxParts <= 1) {
    return { success: false, message: "Delimiter not found in column data." };
  }

  // Generate column names
  const generatedCols = [];
  for (let i = 1; i <= maxParts; i++) {
    generatedCols.push(`${col}.${i}`);
  }

  // Apply split values to each row
  currentRows.forEach(row => {
    const val = row[col] != null ? String(row[col]) : "";
    const parts = val.split(delimiter);
    for (let i = 0; i < maxParts; i++) {
      row[generatedCols[i]] = i < parts.length ? parts[i] : "";
    }
  });

  // Store metadata
  splitState[col] = {
    delimiter: delimiter,
    generatedCols: generatedCols,
    maxParts: maxParts
  };

  // Update effective columns
  effectiveColumns = getEffectiveColumns();

  return { success: true };
}

/**
 * Removes a split and its generated columns.
 * @param {string} col - The original column that was split
 */
function undoSplit(col) {
  if (!splitState[col]) return;

  const removedCols = splitState[col].generatedCols;

  // Remove generated columns from effectiveColumns
  effectiveColumns = effectiveColumns.filter(c => !removedCols.includes(c));

  // Clean row data
  currentRows.forEach(row => {
    removedCols.forEach(gc => { delete row[gc]; });
  });

  // Clean JQL references to removed columns
  const jqlInput = document.getElementById('jqlInput');
  if (jqlInput && jqlInput.value.trim()) {
    let query = jqlInput.value;
    removedCols.forEach(removedCol => {
      // Remove conditions like: colName = "value", colName ~ "value", colName !~ "value"
      // Handle conditions wrapped in parentheses with OR/AND
      const escapedCol = removedCol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Remove standalone conditions (with optional surrounding AND/OR)
      query = query.replace(new RegExp(`\\s*(?:AND|OR)\\s+${escapedCol}\\s*[!~]*=\\s*(?:"[^"]*"|'[^']*'|\\S+)`, 'gi'), '');
      query = query.replace(new RegExp(`${escapedCol}\\s*[!~]*=\\s*(?:"[^"]*"|'[^']*'|\\S+)\\s*(?:AND|OR)\\s*`, 'gi'), '');
      query = query.replace(new RegExp(`${escapedCol}\\s*[!~]*=\\s*(?:"[^"]*"|'[^']*'|\\S+)`, 'gi'), '');
    });
    // Clean up empty parentheses and dangling operators
    query = query.replace(/\(\s*\)/g, '');
    query = query.replace(/^\s*(?:AND|OR)\s+/i, '');
    query = query.replace(/\s+(?:AND|OR)\s*$/i, '');
    query = query.trim();
    jqlInput.value = query;
  }

  // Delete state entry
  delete splitState[col];

  // Re-fetch data with cleaned query
  fetchData();
}

/**
 * Re-applies all active splits to new data rows.
 * Called after fetchData receives new rows.
 * @param {Array<Object>} rows - The raw data rows from server
 * @returns {Array<Object>} - Rows with split columns injected
 */
function applySplitsToRows(rows) {
  Object.keys(splitState).forEach(col => {
    const { delimiter, generatedCols, maxParts } = splitState[col];
    rows.forEach(row => {
      const val = row[col] != null ? String(row[col]) : "";
      const parts = val.split(delimiter);
      for (let i = 0; i < maxParts; i++) {
        row[generatedCols[i]] = i < parts.length ? parts[i] : "";
      }
    });
  });
  return rows;
}

/**
 * Returns the full column list including split columns in correct positions.
 * Iterates allColumns and for each column that has an entry in splitState,
 * inserts the generated columns immediately after it.
 * @returns {string[]}
 */
function getEffectiveColumns() {
  const result = [];
  allColumns.forEach(col => {
    result.push(col);
    if (splitState[col]) {
      splitState[col].generatedCols.forEach(gc => result.push(gc));
    }
  });
  return result;
}

/**
 * Checks if a column is a generated split column.
 * @param {string} col - The column name to check
 * @returns {boolean} true if the column is a split-generated column
 */
function isSplitColumn(col) {
  return Object.values(splitState).some(s => s.generatedCols.includes(col));
}

/**
 * Parses a JQL query to separate split column conditions from original column conditions.
 * Split column conditions are evaluated client-side; original column conditions are sent to the server.
 * @param {string} query - The full JQL query string
 * @returns {{ serverQuery: string, splitConditions: Array<{col: string, op: string, value: string}> }}
 */
function parseSplitConditions(query) {
  if (!query || !query.trim()) {
    return { serverQuery: '', splitConditions: [] };
  }

  // Collect all split column names
  const splitColNames = new Set();
  Object.values(splitState).forEach(s => {
    s.generatedCols.forEach(gc => splitColNames.add(gc));
  });

  // If no splits are active, send everything to server
  if (splitColNames.size === 0) {
    return { serverQuery: query, splitConditions: [] };
  }

  // Parse individual conditions from the query
  // JQL conditions look like: colName = "value", colName ~ "value", colName !~ "value"
  // They can be connected by AND/OR and grouped with parentheses
  const splitConditions = [];
  let serverQuery = query;

  // Match conditions that reference split columns
  // Pattern: columnName operator "value" or columnName operator value
  // Operators: =, ~, !~
  splitColNames.forEach(colName => {
    const escapedCol = colName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match: colName op "quoted value" or colName op unquoted_value
    const condPattern = new RegExp(
      `${escapedCol}\\s*(!=|!~|~|=)\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`,
      'gi'
    );

    let match;
    while ((match = condPattern.exec(query)) !== null) {
      const op = match[1];
      const value = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4]);
      splitConditions.push({ col: colName, op: op, value: value });
    }
  });

  // If no split conditions found, send everything to server
  if (splitConditions.length === 0) {
    return { serverQuery: query, splitConditions: [] };
  }

  // Remove split column conditions from the query to build serverQuery
  splitColNames.forEach(colName => {
    const escapedCol = colName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Remove conditions with surrounding AND/OR connectors
    // Pattern 1: AND/OR before the condition
    serverQuery = serverQuery.replace(
      new RegExp(`\\s+(?:AND|OR)\\s+${escapedCol}\\s*(?:!=|!~|~|=)\\s*(?:"[^"]*"|'[^']*'|\\S+)`, 'gi'),
      ''
    );
    // Pattern 2: condition followed by AND/OR
    serverQuery = serverQuery.replace(
      new RegExp(`${escapedCol}\\s*(?:!=|!~|~|=)\\s*(?:"[^"]*"|'[^']*'|\\S+)\\s+(?:AND|OR)\\s+`, 'gi'),
      ''
    );
    // Pattern 3: standalone condition (no connectors)
    serverQuery = serverQuery.replace(
      new RegExp(`${escapedCol}\\s*(?:!=|!~|~|=)\\s*(?:"[^"]*"|'[^']*'|\\S+)`, 'gi'),
      ''
    );
  });

  // Clean up empty parentheses and dangling operators
  serverQuery = serverQuery.replace(/\(\s*\)/g, '');
  serverQuery = serverQuery.replace(/^\s*(?:AND|OR)\s+/i, '');
  serverQuery = serverQuery.replace(/\s+(?:AND|OR)\s*$/i, '');
  serverQuery = serverQuery.replace(/\(\s*(?:AND|OR)\s+/gi, '(');
  serverQuery = serverQuery.replace(/\s+(?:AND|OR)\s*\)/gi, ')');
  serverQuery = serverQuery.trim();

  return { serverQuery, splitConditions };
}

/**
 * Evaluates split column filter conditions client-side on the given rows.
 * Returns only rows that match ALL split column conditions.
 * @param {Array<Object>} rows - The data rows with split column values
 * @param {Array<{col: string, op: string, value: string}>} splitConditions - Parsed conditions
 * @returns {Array<Object>} - Filtered rows matching all conditions
 */
function evaluateSplitColumnFilters(rows, splitConditions) {
  if (!splitConditions || splitConditions.length === 0) return rows;

  // Validate that all referenced split columns exist
  const splitColNames = new Set();
  Object.values(splitState).forEach(s => {
    s.generatedCols.forEach(gc => splitColNames.add(gc));
  });

  for (const cond of splitConditions) {
    if (!splitColNames.has(cond.col)) {
      // Show error for non-existent split column
      const fltDisplay = document.getElementById('filterTimeDisplay');
      if (fltDisplay) {
        fltDisplay.style.display = 'block';
        fltDisplay.querySelector('.timing-value').innerText = `Error: Column '${cond.col}' not found.`;
      }
      return rows; // Return unfiltered data on error
    }
  }

  return rows.filter(row => {
    return splitConditions.every(cond => {
      const cellValue = row[cond.col] != null ? String(row[cond.col]) : '';
      const condValue = cond.value || '';

      switch (cond.op) {
        case '=':
          return cellValue === condValue;
        case '~':
          return cellValue.toLowerCase().includes(condValue.toLowerCase());
        case '!~':
          return !cellValue.toLowerCase().includes(condValue.toLowerCase());
        default:
          return true;
      }
    });
  });
}

/**
 * Opens context menu and initiates split flow.
 * Shows a prompt dialog for delimiter input, validates, performs split.
 * @param {string} col - The column name to split
 */
function initColumnSplit(col) {
  const delimiter = prompt(`Enter delimiter to split column "${col}":`);

  // User cancelled the prompt
  if (delimiter === null) {
    return;
  }

  // User entered empty string
  if (delimiter === "") {
    alert("Delimiter cannot be empty.");
    return;
  }

  // Validate delimiter
  if (!validateDelimiter(delimiter)) {
    alert("Delimiter must be between 1 and 10 characters.");
    return;
  }

  // Perform the split
  const result = performSplit(col, delimiter);
  if (!result.success) {
    alert(result.message);
    return;
  }

  // Success: re-render header and table body
  renderHeader();
  renderTableBody();
}

/**
 * Re-renders the table body using currentRows and effectiveColumns.
 * Called after a split operation to reflect new columns without re-fetching.
 */
function renderTableBody() {
  const tableBody = document.getElementById('tableBody');
  if (!tableBody) return;

  const cols = getEffectiveColumns();
  tableBody.innerHTML = currentRows.map(row => `
    <tr>${cols.map(col => `<td>${row[col] != null ? row[col] : ''}</td>`).join('')}</tr>
  `).join('');
}

// --- INDEXED DB ---
const dbName = "LogAnalyzerDB";
const storeName = "files";
let db;

async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 3);
    request.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: "name" });
    };
    request.onsuccess = e => { db = e.target.result; resolve(db); };
    request.onerror = e => reject(e.target.error);
  });
}

// --- DRAG AND DROP ---
function setupDragAndDrop() {
  const body = document.querySelector('body');
  const overlay = document.getElementById('dropOverlay');
  if (!body || !overlay) return;

  body.ondragover = e => { e.preventDefault(); overlay.classList.add('active'); };
  body.ondragleave = e => { if (e.relatedTarget === null) overlay.classList.remove('active'); };
  body.ondrop = e => { e.preventDefault(); overlay.classList.remove('active'); processUpload(e.dataTransfer.files[0]); };
}

// --- ACTIONS ---
function toggleSidebar() { document.getElementById('appGrid').classList.toggle('sidebar-hidden'); }
function toggleAnalyzer() { document.getElementById('appGrid').classList.toggle('analyzer-hidden'); }

async function clearAllData() {
  if (!confirm("Isso apagará TODO o histórico local e sessões. Continuar?")) return;

  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  const clearReq = store.clear();

  clearReq.onsuccess = () => {
    localStorage.removeItem('last_session_id');
    currentSessionId = "";
    resetUI();
    loadHistory();
    alert("Todos os dados locais foram limpos.");
  };
}

async function loadHistory() {
  const tx = db.transaction(storeName, "readonly");
  const req = tx.objectStore(storeName).getAll();
  req.onsuccess = () => {
    const files = req.result;
    let totalSize = 0;

    const groups = {};
    files.forEach(f => {
      totalSize += (f.blob ? f.blob.size : 0);
      const groupKey = f.originalFile || f.name;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(f);
    });

    const historyList = document.getElementById('historyList');
    if (!historyList) return;

    historyList.innerHTML = Object.keys(groups)
      .map(key => {
        const group = groups[key];
        const maxTimestamp = Math.max(...group.map(f => {
          if (f.timestamp) return f.timestamp;
          const parsed = new Date(f.date).getTime();
          return isNaN(parsed) ? 0 : parsed;
        }));
        return { key, group, maxTimestamp };
      })
      .sort((a, b) => b.maxTimestamp - a.maxTimestamp)
      .map(({ key, group }) => {
        const master = group[0];
        const isMulti = group.length > 1;
        const isActive = group.some(f => currentFilename === f.name);

        return `
          <div class="p-3 mb-1 history-item ${isActive ? 'active' : ''}">
            <div class="d-flex justify-content-between align-items-start" onclick="loadFromHistory('${master.name}')">
              <div class="d-flex flex-column" style="flex: 1; min-width: 0;">
                <div class="d-flex align-items-center gap-2">
                  <span class="text-truncate fw-bold text-warning" title="${master.tag || key}">${master.tag || key}</span>
                  ${isMulti ? `
                    <select class="form-select form-select-sm border-secondary py-0" 
                            style="font-size: 10px; height: 20px; width: auto; max-width: 120px; background: var(--wm-bg-input); color: var(--wm-text-primary); border-color: var(--wm-border);" 
                            onclick="event.stopPropagation()"
                            onchange="loadFromHistory(this.value)">
                      <option value="" disabled selected>Selecione...</option>
                      ${group.map(f => `<option value="${f.name}" ${currentFilename === f.name ? 'selected' : ''}>${f.sheetName || 'Aba'}</option>`).join('')}
                    </select>
                  ` : ''}
                </div>
                <small class="text-truncate" style="font-size: 10px; color: var(--wm-text-secondary);">${key}</small>
              </div>
              <div class="history-actions ms-2">
                <i class="bi bi-tag text-info" title="Renomear" onclick="event.stopPropagation(); renameTag('${master.name}')"></i>
                <i class="bi bi-trash text-danger" title="Excluir" onclick="event.stopPropagation(); deleteFileGroup('${key}')"></i>
              </div>
            </div>
            <div class="d-flex justify-content-between align-items-center mt-2" style="font-size: 10px;">
              <span class="opacity-50">
                ${master.date} • 
                <span title="Original / Compresso">
                  ${master.originalSize ? (master.originalSize / (1024 * 1024)).toFixed(2) : '?'} / 
                  ${(group.reduce((acc, f) => acc + (f.blob ? f.blob.size : 0), 0) / (1024 * 1024)).toFixed(2)} MB
                </span>
              </span>
              ${master.serverTime ? `
                <span class="text-warning history-timing-hover fw-bold d-flex align-items-center gap-1" data-breakdown="${master.stagesBreakdown || 'Timing details not available'}" style="cursor:help;">
                  ${master.serverTime}s <i class="bi bi-clock-history"></i>
                </span>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

    const sizeDisplay = document.getElementById('totalSizeDisplay');
    if (sizeDisplay) sizeDisplay.innerText = `Total: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`;
  };
}

async function deleteFileGroup(originalKey) {
  if (!confirm(`Excluir todas as abas de ${originalKey}?`)) return;
  const tx = db.transaction(storeName, "readonly");
  const req = tx.objectStore(storeName).getAll();
  req.onsuccess = async () => {
    const toDelete = req.result.filter(f => (f.originalFile || f.name) === originalKey);
    const deleteTx = db.transaction(storeName, "readwrite");
    for (const f of toDelete) {
      deleteTx.objectStore(storeName).delete(f.name);
      fetch('/delete_session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: currentSessionId })
      });
      if (currentFilename === f.name) resetUI();
    }
    deleteTx.oncomplete = () => loadHistory();
  };
}

function resetUI() {
  // Clear all split state (temporary, client-side only)
  Object.keys(splitState).forEach(key => delete splitState[key]);
  effectiveColumns = [];
  currentRows = [];

  currentFilename = "";
  allColumns = [];
  columnOptions = {};
  columnTypes = {};
  currentPage = 1;
  currentAnalyzedCol = null;
  const activeDisplay = document.getElementById('activeFileDisplay');
  if (activeDisplay) activeDisplay.innerText = "UNSET";

  const headerRow = document.getElementById('headerRow');
  if (headerRow) headerRow.innerHTML = "";

  const tableBody = document.getElementById('tableBody');
  if (tableBody) tableBody.innerHTML = "";

  const pageStats = document.getElementById('pageStats');
  if (pageStats) pageStats.innerText = "Exibindo 0-0 de 0";

  const fltDisplay = document.getElementById('filterTimeDisplay');
  if (fltDisplay) fltDisplay.style.display = 'none';

  const appGrid = document.getElementById('appGrid');
  if (appGrid) appGrid.classList.add('analyzer-hidden');
}

async function renameTag(name) {
  const file = await getFile(name);
  const groupKey = file.originalFile || file.name;
  const current = file.tag || groupKey;
  const newTag = prompt("Custom Name (Tag)", current);

  if (newTag !== null) {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => {
      const files = req.result.filter(f => (f.originalFile || f.name) === groupKey);
      const writeTx = db.transaction(storeName, "readwrite");
      files.forEach(f => {
        f.tag = newTag;
        writeTx.objectStore(storeName).put(f);
      });
      writeTx.oncomplete = () => {
        loadHistory();
        updateActiveDisplay();
      };
    };
  }
}

async function updateActiveDisplay() {
  const fileRecord = await getFile(currentFilename);
  const tag = fileRecord?.tag || "";
  const originalName = fileRecord?.originalFile || fileRecord?.name || currentFilename;
  const activeDisplay = document.getElementById('activeFileDisplay');
  if (activeDisplay) {
    activeDisplay.innerText = tag && tag !== originalName ? `${tag}` : originalName;
  }
}

async function getFile(name) {
  return new Promise(resolve => {
    db.transaction(storeName, "readonly").objectStore(storeName).get(name).onsuccess = e => resolve(e.target.result);
  });
}

async function loadFromHistory(name) {
  if (name === currentFilename) {
    const appGrid = document.getElementById('appGrid');
    if (appGrid) appGrid.classList.add('sidebar-hidden');
    return;
  }
  const file = await getFile(name);
  if (file) {
    const jqlInput = document.getElementById('jqlInput');
    if (jqlInput) {
      jqlInput.value = "";
      jqlInput.style.height = '40px';
    }
    processUpload(file.blob, true, name);
    const appGrid = document.getElementById('appGrid');
    if (appGrid) appGrid.classList.add('sidebar-hidden');
  }
}

function processUpload(file, isHistory = false, historyName = "", sheetName = "", keepLoader = false) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve();

    // Reset state for new file
    if (!keepLoader) {
      currentPage = 1;
      // Clear split state when loading a new file
      Object.keys(splitState).forEach(key => delete splitState[key]);
      effectiveColumns = [];
      currentRows = [];
      const jqlInput = document.getElementById('jqlInput');
      if (jqlInput) {
        jqlInput.value = "";
        jqlInput.style.height = '40px';
      }
    }

    const loaderMsg = isHistory ? "CARREGANDO RELATÓRIO..." : "PROCESSANDO ARQUIVO...";
    if (!keepLoader) setLoading(true, loaderMsg);

    const totalStartTime = Date.now();
    const originalSize = file.size;
    const progressBar = document.getElementById('loaderProgressBar');

    const formData = new FormData();
    formData.append('file', file, historyName || file.name);
    // Reuse session if exists and we are just re-loading the same file from history
    // (though usually we want a fresh session for the dataframe)
    if (currentSessionId) formData.append('session_id', currentSessionId);
    if (sheetName) formData.append('sheet_name', sheetName);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload', true);
    xhr.responseType = 'arraybuffer';

    const timestamp = Date.now() + Math.random();
    const uploadStageId = (sheetName ? `UPLOAD_${sheetName.replace(/\s+/g, '_')}` : "UPLOAD") + "_" + timestamp;
    const uploadLabel = isHistory ? `ABRINDO BANCO LOCAL: ${sheetName || 'Dados'}` : (sheetName ? `LENDO ABA: ${sheetName}` : "UPLOADING FILE");
    const optimizingStageId = "OPTIMIZING_" + (sheetName || "") + "_" + timestamp;
    const optimizingLabel = isHistory ? "VERIFICANDO INTEGRIDADE" : "OPTIMIZING FILE CACHE";

    addStage(uploadStageId, uploadLabel);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = (e.loaded / e.total) * 100;
        progressBar.style.width = (percent * 0.7) + '%';
        updateStage(uploadStageId, `${uploadLabel} (${Math.round(percent)}%)`);
      }
    };

    xhr.upload.onload = () => {
      finishStage(uploadStageId);
      if (!stages[optimizingStageId]) {
        addStage(optimizingStageId, optimizingLabel);
        progressBar.style.width = '75%';
      }
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          if (stages[uploadStageId] && !stages[uploadStageId].end) finishStage(uploadStageId);
          if (!stages[optimizingStageId]) addStage(optimizingStageId, optimizingLabel);

          progressBar.style.width = '80%';

          const metadataRaw = xhr.getResponseHeader('X-Log-Metadata');
          let res;
          if (metadataRaw) {
            res = JSON.parse(metadataRaw);
          } else {
            const decoder = new TextDecoder('utf-8');
            res = JSON.parse(decoder.decode(xhr.response));
          }

          if (res.error) throw new Error(res.error);

          if (res.multi_sheet && !sheetName) {
            if (res.session_id) currentSessionId = res.session_id;
            for (const sName of res.sheets) {
              await processUpload(file, false, "", sName, true);
            }
            finishStage(optimizingStageId);
            setTimeout(() => setLoading(false), 800);
            return resolve();
          }

          currentSessionId = res.session_id;
          localStorage.setItem('last_session_id', currentSessionId);

          const sheetTitle = sheetName ? ` [${sheetName}]` : "";
          currentFilename = historyName || (file.name + sheetTitle);
          allColumns = res.columns || [];
          columnOptions = res.options || {};
          columnTypes = res.column_types || {};
          let blobToStore = new Blob([xhr.response], { type: 'application/octet-stream' });
          if (!currentFilename.endsWith('.parquet')) {
            currentFilename = currentFilename.split('.')[0] + sheetTitle + '.parquet';
          }

          finishStage(optimizingStageId);

          const uiStageId = "UI_" + (sheetName || "") + "_" + Date.now();
          addStage(uiStageId, "PREPARING INTERFACE");
          progressBar.style.width = '95%';

          await updateActiveDisplay();
          renderHeader();
          await fetchData(true);

          finishStage(uiStageId);
          progressBar.style.width = '100%';

          const totalCumulativeTime = ((Date.now() - totalStartTime) / 1000).toFixed(3);

          const breakdown = "Tempo de processamento:\n" + Object.keys(stages).map(id => {
            const s = stages[id];
            const dur = s.end ? ((s.end - s.start) / 1000).toFixed(2) : "?";
            return `• ${s.label}: ${dur}s`;
          }).join('\n');

          if (!isHistory) {
            const tx = db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            store.put({
              name: currentFilename,
              blob: blobToStore,
              date: new Date().toLocaleString(),
              timestamp: Date.now(),
              tag: file.name + sheetTitle,
              originalFile: file.name,
              sheetName: sheetName,
              originalSize: originalSize,
              importTime: res.import_time,
              serverTime: totalCumulativeTime,
              stagesBreakdown: breakdown
            });
            tx.oncomplete = () => loadHistory();
          } else {
            loadHistory();
          }

          if (!keepLoader) {
            setTimeout(() => setLoading(false), 800);
          }
          resolve();
        } catch (e) {
          alert("Upload fail: " + e.message);
          setLoading(false);
          reject(e);
        }
      } else {
        alert("Upload failed with status: " + xhr.status);
        setLoading(false);
        reject(new Error(xhr.statusText));
      }
    };

    xhr.onerror = () => {
      alert("Network error during upload.");
      setLoading(false);
      reject(new Error("Network Error"));
    };

    xhr.send(formData);
  });
}

function renderHeader() {
  const headerRow = document.getElementById('headerRow');
  if (!headerRow || !allColumns || !Array.isArray(allColumns)) {
    console.error("allColumns is not an array:", allColumns);
    return;
  }

  const cols = getEffectiveColumns();

  // Determine which columns are generated (split) columns
  const generatedCols = new Set();
  Object.keys(splitState).forEach(srcCol => {
    splitState[srcCol].generatedCols.forEach(gc => generatedCols.add(gc));
  });

  headerRow.innerHTML = `<tr>${cols.map(col => {
    const type = columnTypes[col] || 'text';
    const icon = TYPE_ICONS[type];
    const isGenerated = generatedCols.has(col);
    const hasSplit = !!splitState[col];
    const escapedCol = col.replace(/'/g, "\\'");

    // Split indicator for columns that have an active split
    const splitIndicator = hasSplit
      ? `<span class="split-indicator" onclick="event.stopPropagation(); undoSplit('${escapedCol}')" title="Undo split"><i class="bi bi-scissors"></i></span>`
      : '';

    return `
    <th onclick="analyzeColumn('${escapedCol}')" class="${currentAnalyzedCol === col ? 'analyzing' : ''}" ${!isGenerated ? `oncontextmenu="showContextMenu(event, [{label: '<i class=\\'bi bi-scissors\\'></i> Split Column by Delimiter', action: () => initColumnSplit('${escapedCol}')}])"` : ''}>
      <span class="type-indicator" title="${type}"><i class="bi ${icon}"></i></span>
      <span>${col}</span>${splitIndicator} <i class="bi bi-arrow-down-up float-end opacity-25" onclick="event.stopPropagation(); applySort('${escapedCol}')"></i>
      <div class="col-resize-handle" onmousedown="event.stopPropagation(); initColResize(event, this)"></div>
    </th>
  `;
  }).join('')}</tr>`;
}

// --- COLUMN RESIZE ---
function initColResize(e, handle) {
  e.preventDefault();
  const th = handle.parentElement;
  const startX = e.pageX;
  const startWidth = th.offsetWidth;

  handle.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  function onMouseMove(ev) {
    const newWidth = Math.max(40, startWidth + (ev.pageX - startX));
    th.style.width = newWidth + 'px';
    th.style.minWidth = newWidth + 'px';
    th.style.maxWidth = newWidth + 'px';

    // Apply same width to all cells in this column
    const colIndex = Array.from(th.parentElement.children).indexOf(th);
    const rows = document.querySelectorAll('#tableBody tr');
    rows.forEach(row => {
      const cell = row.children[colIndex];
      if (cell) {
        cell.style.width = newWidth + 'px';
        cell.style.minWidth = newWidth + 'px';
        cell.style.maxWidth = newWidth + 'px';
      }
    });
  }

  function onMouseUp() {
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

function applySort(col) {
  sortState.dir = (sortState.col === col && sortState.dir === 'asc') ? 'desc' : 'asc';
  sortState.col = col;

  // If it's a split column, sort client-side since the server doesn't know about it
  if (isSplitColumn(col)) {
    const dir = sortState.dir;
    currentRows.sort((a, b) => {
      const valA = a[col] != null ? String(a[col]) : '';
      const valB = b[col] != null ? String(b[col]) : '';
      const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      return dir === 'asc' ? cmp : -cmp;
    });
    renderTableBody();
    return;
  }

  fetchData();
}

async function fetchData(silent = false) {
  if (!currentSessionId) return;
  const input = document.getElementById('jqlInput');
  const query = input ? input.value.trim() : "";
  const startTime = Date.now();
  if (!silent) setLoading(true);
  try {
    // Parse JQL to separate split column conditions from server conditions
    const { serverQuery, splitConditions } = parseSplitConditions(query);

    const res = await fetch('/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: currentSessionId, jql_query: serverQuery,
        page: currentPage, sort_col: sortState.col, sort_dir: sortState.dir
      })
    }).then(r => r.json());

    if (res.error) {
      if (res.error.includes("expirada")) { loadFromHistory(currentFilename); return; }
      throw new Error(res.error);
    }

    // Store rows and apply active splits
    currentRows = res.data;
    applySplitsToRows(currentRows);

    // Apply split column filters client-side
    if (splitConditions.length > 0) {
      currentRows = evaluateSplitColumnFilters(currentRows, splitConditions);
    }

    effectiveColumns = getEffectiveColumns();

    const tableBody = document.getElementById('tableBody');
    if (tableBody) {
      tableBody.innerHTML = currentRows.map(row => `
        <tr>${effectiveColumns.map(col => `<td>${row[col] != null ? row[col] : ''}</td>`).join('')}</tr>
      `).join('');
    }

    const displayTotal = splitConditions.length > 0 ? currentRows.length : res.total_count;
    const totalPages = Math.ceil(displayTotal / 100);
    const start = displayTotal > 0 ? (currentPage - 1) * 100 + 1 : 0;
    const end = Math.min(currentPage * 100, displayTotal);

    const pageStats = document.getElementById('pageStats');
    if (pageStats) pageStats.innerText = `Exibindo ${start}-${end} de ${displayTotal.toLocaleString()}`;

    const fetchTotalTime = ((Date.now() - startTime) / 1000).toFixed(3);
    const fltDisplay = document.getElementById('filterTimeDisplay');
    if (fltDisplay) {
      fltDisplay.style.display = 'block';
      fltDisplay.querySelector('.timing-value').innerText = `${res.filter_time} (Client: ${fetchTotalTime}s)`;
    }

    const pageDisplay = document.getElementById('currentPageDisplay');
    if (pageDisplay) pageDisplay.innerText = `${currentPage} / ${totalPages || 1}`;

    // BUG FIX/OPTIMIZATION: Re-analyze column efficiently when filters change
    if (currentAnalyzedCol) analyzeColumn(currentAnalyzedCol, true);
  } catch (e) { console.error(e); }
  finally { if (!silent) setLoading(false); }
}

/**
 * Renders a stat card with an embedded filter button.
 * The filter button is hidden by default and shown on hover via CSS.
 * @param {string} col - Column being analyzed
 * @param {{ value: string, count: number }} stat - Stat data
 * @param {number} totalRows - Total rows for percentage bar calculation
 * @returns {string} - HTML string for the stat card
 */
function renderStatCard(col, stat, totalRows) {
  const escapedCol = String(col).replace(/'/g, "\\'").replace(/\\/g, "\\\\");
  const escapedVal = String(stat.value != null ? stat.value : '').replace(/'/g, "\\'").replace(/\\/g, "\\\\");
  const displayValue = stat.value != null && stat.value !== '' ? stat.value : 'null';
  const percentage = (stat.count / totalRows * 100);

  return `
    <div class="stat-card">
      <div class="d-flex justify-content-between align-items-center small">
        <span class="stat-value">${displayValue}</span>
        <div class="d-flex align-items-center gap-2">
          <b>${stat.count.toLocaleString()}</b>
          <button class="filter-btn" onclick="event.stopPropagation(); quickFilter('${escapedCol}', '${escapedVal}')" aria-label="Filter by ${displayValue}" tabindex="0">
            <i class="bi bi-funnel-fill"></i>
          </button>
        </div>
      </div>
      <div class="stat-bar" style="width:${percentage}%"></div>
    </div>
  `;
}

async function analyzeColumn(col, skipHeader = false) {
  if (!col) return;
  currentAnalyzedCol = col;
  const colNameDisplay = document.getElementById('selectedColName');
  if (colNameDisplay) colNameDisplay.innerText = col;
  if (!skipHeader) renderHeader();

  // If it's a split column, compute distribution client-side
  if (isSplitColumn(col)) {
    try {
      // Count occurrences of each value in currentRows for this column
      const counts = {};
      currentRows.forEach(row => {
        const val = row[col] != null ? String(row[col]) : '';
        counts[val] = (counts[val] || 0) + 1;
      });

      // Sort by count descending, take top 50
      const stats = Object.entries(counts)
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50);

      const uniqueCount = Object.keys(counts).length;
      const totalRows = currentRows.length;

      // Show unique count badge
      const badge = document.getElementById('uniqueCountBadge');
      if (badge) {
        badge.innerText = uniqueCount;
        badge.style.display = 'block';
      }

      // Render stat cards
      const distList = document.getElementById('distributionList');
      if (distList) {
        distList.innerHTML = stats.map(s => renderStatCard(col, s, totalRows)).join('');
      }

      const appGrid = document.getElementById('appGrid');
      if (appGrid) appGrid.classList.remove('analyzer-hidden');
    } catch (e) {
      console.error("Client-side analysis error:", e);
      const appGrid = document.getElementById('appGrid');
      if (appGrid) appGrid.classList.add('analyzer-hidden');
      currentAnalyzedCol = null;
    }
    return;
  }

  try {
    const jqlInput = document.getElementById('jqlInput');
    const query = jqlInput ? jqlInput.value : "";

    const res = await fetch('/analyze_column', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: currentSessionId, column: col, jql_query: query })
    }).then(r => r.json());

    if (res.error) {
      const appGrid = document.getElementById('appGrid');
      if (appGrid) appGrid.classList.add('analyzer-hidden');
      currentAnalyzedCol = null;
      return;
    }

    const badge = document.getElementById('uniqueCountBadge');
    if (badge) {
      badge.innerText = res.unique_values;
      badge.style.display = 'block';
    }

    const distList = document.getElementById('distributionList');
    if (distList) {
      distList.innerHTML = res.stats.map(s => renderStatCard(col, s, res.total_rows)).join('');
    }

    const appGrid = document.getElementById('appGrid');
    if (appGrid) appGrid.classList.remove('analyzer-hidden');
  } catch (e) {
    console.error("Analysis error:", e);
    const appGrid = document.getElementById('appGrid');
    if (appGrid) appGrid.classList.add('analyzer-hidden');
    currentAnalyzedCol = null;
  }
}

function quickFilter(col, val) {
  const ipt = document.getElementById('jqlInput');
  if (!ipt) return;

  let q = ipt.value.trim();
  const newCond = `${col} = "${val}"`;

  if (q === "") {
    ipt.value = newCond;
  } else {
    // Basic logic to append OR if the column is already being filtered, or AND if it's a different column
    // This part could be improved but it's consistent with original
    const pattern = new RegExp(`\\((${col}\\s*!?~?=[^)]+)\\)`, 'i');
    const match = q.match(pattern);

    if (match) {
      ipt.value = q.replace(pattern, `($1 OR ${newCond})`);
    } else if (new RegExp(`\\b${col}\\s*!?~?=`, 'i').test(q)) {
      const soloPattern = new RegExp(`(${col}\\s*!?~?=[^\\s]+(?:\\s*"[^"]*")?)`, 'i');
      ipt.value = q.replace(soloPattern, `($1 OR ${newCond})`);
    } else {
      ipt.value = `(${q}) AND ${newCond}`;
    }
  }
  currentPage = 1;
  fetchData();
}

async function exportToExcel() {
  if (!currentSessionId) return;
  setLoading(true);
  try {
    const jqlInput = document.getElementById('jqlInput');
    const query = jqlInput ? jqlInput.value : "";

    // If split columns are active, generate a client-side CSV export
    if (Object.keys(splitState).length > 0) {
      await exportClientSideWithSplits(query);
      return;
    }

    const resp = await fetch('/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: currentSessionId, jql_query: query })
    });
    if (resp.status === 404) { alert("Session expired. Refreshing..."); loadFromHistory(currentFilename); return; }
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);

    const fileData = await getFile(currentFilename);
    const baseName = (fileData?.tag || currentFilename).split('.')[0];
    const downloadName = `${baseName}_export_${new Date().toISOString().slice(0, 10)}.xlsx`;

    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    a.click();
  } finally { setLoading(false); }
}

/**
 * Generates a client-side CSV export that includes split columns.
 * Fetches all filtered data from the server (page by page), applies splits,
 * and downloads as CSV with split columns positioned after their source column.
 * @param {string} query - The current JQL query
 */
async function exportClientSideWithSplits(query) {
  // Parse JQL to separate split column conditions from server conditions
  const { serverQuery, splitConditions } = parseSplitConditions(query);

  // Fetch all pages of data from the server
  let allRows = [];
  let page = 1;
  let totalCount = Infinity;

  while (allRows.length < totalCount) {
    const res = await fetch('/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: currentSessionId,
        jql_query: serverQuery,
        page: page,
        sort_col: sortState.col,
        sort_dir: sortState.dir
      })
    }).then(r => r.json());

    if (res.error) {
      if (res.error.includes("expirada")) { alert("Session expired. Refreshing..."); loadFromHistory(currentFilename); return; }
      throw new Error(res.error);
    }

    totalCount = res.total_count;
    if (res.data.length === 0) break;
    allRows = allRows.concat(res.data);
    page++;
  }

  // Apply splits to all fetched rows
  applySplitsToRows(allRows);

  // Apply split column filters client-side if needed
  if (splitConditions.length > 0) {
    allRows = evaluateSplitColumnFilters(allRows, splitConditions);
  }

  // Build CSV using effective columns (includes split columns in correct positions)
  const cols = getEffectiveColumns();
  const csvRows = [cols.map(col => escapeCsvValue(col)).join(',')]; // header row

  allRows.forEach(row => {
    csvRows.push(cols.map(col => {
      const val = row[col] != null ? String(row[col]) : '';
      return escapeCsvValue(val);
    }).join(','));
  });

  const csvContent = csvRows.join('\n');
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const fileData = await getFile(currentFilename);
  const baseName = (fileData?.tag || currentFilename).split('.')[0];
  const downloadName = `${baseName}_split_export_${new Date().toISOString().slice(0, 10)}.csv`;

  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Escapes a value for CSV format.
 * Wraps in quotes if the value contains commas, quotes, or newlines.
 * @param {string} val - The value to escape
 * @returns {string} - The escaped CSV value
 */
function escapeCsvValue(val) {
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

async function exportDistributionCSV() {
  if (!currentSessionId || !currentAnalyzedCol) return;
  setLoading(true);
  try {
    const jqlInput = document.getElementById('jqlInput');
    const query = jqlInput ? jqlInput.value : "";

    const resp = await fetch('/export_distribution', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: currentSessionId, column: currentAnalyzedCol, jql_query: query })
    });
    
    if (resp.status === 404) { alert("Session expired. Refreshing..."); loadFromHistory(currentFilename); return; }
    if (!resp.ok) { 
      const err = await resp.json();
      throw new Error(err.error || "Export failed");
    }

    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const downloadName = `coluna_${currentAnalyzedCol}_${new Date().toISOString().slice(0, 10)}.csv`;

    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    alert("Export failed: " + e.message);
  } finally { setLoading(false); }
}

// --- JQL SUGGESTIONS ---
function setupJQLSuggestions() {
  const input = document.getElementById('jqlInput');
  if (!input) return;

  // Auto-resize textarea
  input.addEventListener('input', function () {
    this.style.height = '40px';
    this.style.height = (this.scrollHeight) + 'px';
  });

  input.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const sug = document.getElementById('jqlSuggestions');
      if (sug) sug.style.display = 'none';
      currentPage = 1;
      fetchData();
    }
  };

  input.onkeyup = e => {
    if (e.key === 'Enter' && !e.shiftKey) return;

    const val = e.target.value;
    let pts = val.split(/[\s()]+OR[\s()]+|[\s()]+AND[\s()]+|[()]/i);
    let last = pts.pop().trim();
    const ops = ['=', '!~', '~'];
    let currentOp = ops.find(o => last.includes(o));
    if (currentOp) {
      const segs = last.split(currentOp);
      showSuggestions(columnOptions[segs[0].trim()] || [], segs[1]?.trim().replace(/['"]/g, '') || "", true);
    } else { showSuggestions(allColumns, last, false); }
  };
}

function showSuggestions(list, q, isVal) {
  const box = document.getElementById('jqlSuggestions');
  if (!box) return;

  const filtered = list.filter(i => String(i).toLowerCase().includes(q.toLowerCase())).slice(0, 10);
  if (filtered.length > 0 && q !== "") {
    box.innerHTML = filtered.map(i => `<div class='suggestion-item' onclick="applySug('${i}', ${isVal})"><b>${i}</b></div>`).join('');
    box.style.display = 'block';
  } else { box.style.display = 'none'; }
}

function applySug(v, isVal) {
  const ipt = document.getElementById('jqlInput');
  if (!ipt) return;
  const t = ipt.value;
  if (isVal) {
    const lastIdx = Math.max(t.lastIndexOf('='), t.lastIndexOf('~'), t.lastIndexOf('!~'));
    ipt.value = `${t.substring(0, lastIdx + 1)} "${v}" `;
  } else {
    const lastSpc = Math.max(t.lastIndexOf(' '), t.lastIndexOf('('));
    ipt.value = `${t.substring(0, lastSpc + 1)}${v} = `;
  }
  const sug = document.getElementById('jqlSuggestions');
  if (sug) sug.style.display = 'none';
  ipt.focus();
}

// --- LOADER ---
let loaderInterval;
let loaderStartTime;
let stages = {};

function setLoading(v, text = "PROCESSING...") {
  const container = document.getElementById('tableContainer');
  const loader = document.getElementById('mainLoader');
  const timerDisplay = document.getElementById('loaderTimer');
  const textDisplay = document.getElementById('loaderText');
  const progressBar = document.getElementById('loaderProgressBar');
  const stagesDisplay = document.getElementById('loaderStages');
  const progressContainer = document.getElementById('loaderProgressContainer');

  if (container) container.classList.toggle('loading', v);
  if (loader) loader.style.display = v ? 'block' : 'none';
  if (textDisplay) textDisplay.innerText = text;

  if (v) {
    loaderStartTime = Date.now();
    stages = {};
    if (stagesDisplay) stagesDisplay.innerHTML = "";
    if (progressContainer) progressContainer.style.display = 'block';

    if (loaderInterval) clearInterval(loaderInterval);
    loaderInterval = setInterval(() => {
      const elapsed = ((Date.now() - loaderStartTime) / 1000).toFixed(1);
      if (timerDisplay) timerDisplay.innerText = `${elapsed}s`;

      // Update active stage timer
      Object.keys(stages).forEach(id => {
        if (!stages[id].end) {
          const stageElapsed = ((Date.now() - stages[id].start) / 1000).toFixed(1);
          const el = document.getElementById(`stage-timer-${id}`);
          if (el) el.innerText = `${stageElapsed}s`;
        }
      });
    }, 100);
  } else {
    if (loaderInterval) clearInterval(loaderInterval);
    if (timerDisplay) timerDisplay.innerText = "0.0s";
    if (progressBar) progressBar.style.width = '0%';
    if (progressContainer) progressContainer.style.display = 'none';
  }
}

function addStage(id, label) {
  const stagesDisplay = document.getElementById('loaderStages');
  if (!stagesDisplay) return;
  const stageName = label || id;
  stages[id] = { start: Date.now(), end: null, label: stageName };
  stagesDisplay.innerHTML += `
    <div class="d-flex justify-content-between mb-1 opacity-75" id="stage-${id}">
      <span><i class="bi bi-clock-history me-2"></i>${stageName}</span>
      <span id="stage-timer-${id}" class="text-warning">0.0s</span>
    </div>
  `;
}

function updateStage(id, label) {
  const el = document.querySelector(`#stage-${id} span`);
  if (el) el.innerHTML = `<i class="bi bi-clock-history me-2"></i>${label}`;
}

function finishStage(id) {
  if (stages[id]) {
    stages[id].end = Date.now();
    const final = ((stages[id].end - stages[id].start) / 1000).toFixed(1);
    const el = document.getElementById(`stage-${id}`);
    const timer = document.getElementById(`stage-timer-${id}`);
    if (el) {
      el.classList.remove('opacity-75');
      el.classList.add('text-success');
      const icon = el.querySelector('i');
      if (icon) icon.className = 'bi bi-check-circle-fill me-2';
    }
    if (timer) timer.innerText = `${final}s`;
  }
}

function changePage(v) {
  currentPage = Math.max(1, currentPage + v);
  fetchData(true);
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
  setupDragAndDrop();
  setupJQLSuggestions();

  const sidebarTrigger = document.getElementById('sidebarTrigger');
  if (sidebarTrigger) {
    sidebarTrigger.onmouseenter = () => {
      const appGrid = document.getElementById('appGrid');
      if (appGrid) appGrid.classList.remove('sidebar-hidden');
    };
  }

  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.onchange = e => processUpload(e.target.files[0]);
  }

  initDB().then(loadHistory);
});
