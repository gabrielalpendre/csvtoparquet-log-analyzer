let currentSessionId = localStorage.getItem('last_session_id') || "";
let currentFilename = "";
let allColumns = [];
let columnOptions = {};
let currentPage = 1;
let sortState = { col: null, dir: 'asc' };
let currentAnalyzedCol = null;

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
                    <select class="form-select form-select-sm bg-dark text-white border-secondary py-0" 
                            style="font-size: 10px; height: 20px; width: auto; max-width: 120px;" 
                            onclick="event.stopPropagation()"
                            onchange="loadFromHistory(this.value)">
                      <option value="" disabled selected>Selecione...</option>
                      ${group.map(f => `<option value="${f.name}" ${currentFilename === f.name ? 'selected' : ''}>${f.sheetName || 'Aba'}</option>`).join('')}
                    </select>
                  ` : ''}
                </div>
                <small class="text-white opacity-50 text-truncate" style="font-size: 10px;">${key}</small>
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
  currentFilename = "";
  allColumns = [];
  columnOptions = {};
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
  headerRow.innerHTML = `<tr>${allColumns.map(col => `
    <th onclick="analyzeColumn('${col}')" class="${currentAnalyzedCol === col ? 'analyzing' : ''}">
      <span>${col}</span> <i class="bi bi-arrow-down-up float-end opacity-25" onclick="event.stopPropagation(); applySort('${col}')"></i>
    </th>
  `).join('')}</tr>`;
}

function applySort(col) {
  sortState.dir = (sortState.col === col && sortState.dir === 'asc') ? 'desc' : 'asc';
  sortState.col = col;
  fetchData();
}

async function fetchData(silent = false) {
  if (!currentSessionId) return;
  const input = document.getElementById('jqlInput');
  const query = input ? input.value.trim() : "";
  const startTime = Date.now();
  if (!silent) setLoading(true);
  try {
    const res = await fetch('/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: currentSessionId, jql_query: query,
        page: currentPage, sort_col: sortState.col, sort_dir: sortState.dir
      })
    }).then(r => r.json());

    if (res.error) {
      if (res.error.includes("expirada")) { loadFromHistory(currentFilename); return; }
      throw new Error(res.error);
    }

    const tableBody = document.getElementById('tableBody');
    if (tableBody) {
      tableBody.innerHTML = res.data.map(row => `
        <tr>${allColumns.map(col => `<td>${row[col] || ''}</td>`).join('')}</tr>
      `).join('');
    }

    const totalPages = Math.ceil(res.total_count / 100);
    const start = (currentPage - 1) * 100 + 1;
    const end = Math.min(currentPage * 100, res.total_count);

    const pageStats = document.getElementById('pageStats');
    if (pageStats) pageStats.innerText = `Exibindo ${start}-${end} de ${res.total_count.toLocaleString()}`;

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

async function analyzeColumn(col, skipHeader = false) {
  if (!col) return;
  currentAnalyzedCol = col;
  const colNameDisplay = document.getElementById('selectedColName');
  if (colNameDisplay) colNameDisplay.innerText = col;
  if (!skipHeader) renderHeader();

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
      distList.innerHTML = res.stats.map(s => `
        <div class="stat-card" onclick="quickFilter('${col}', '${s.value}')">
          <div class="d-flex justify-content-between small"><span>${s.value || 'null'}</span> <b>${s.count.toLocaleString()}</b></div>
          <div class="stat-bar" style="width:${(s.count / res.total_rows * 100)}%"></div>
        </div>
      `).join('');
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
