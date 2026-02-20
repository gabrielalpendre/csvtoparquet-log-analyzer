from flask import Flask, render_template, request, jsonify, send_file
import pandas as pd
import os
import re
import io
import time
import uuid
from datetime import datetime
from cachelib import FileSystemCache

app = Flask(__name__)
app.secret_key = str(uuid.uuid4())

cache = FileSystemCache('flask_cache', threshold=100, default_timeout=3600)

def parse_jql_to_mask(df, query):
    query = query.strip()
    while '(' in query:
        match = re.search(r'\(([^()]+)\)', query)
        if not match: break
        inner_query = match.group(1)
        mask = parse_jql_to_mask(df, inner_query)
        break
    
    def evaluate_simple_condition(col, op, val):
        if col not in df.columns: return pd.Series([True] * len(df))
        if op == "=":
            return (df[col].astype(str) == val)
        elif op == "~":
            return (df[col].astype(str).str.contains(val, case=False, na=False))
        elif op == "!~":
            return ~(df[col].astype(str).str.contains(val, case=False, na=False))
        else:
            return pd.Series([True] * len(df))

    tokens = re.findall(r'(\w+)\s*(!?~|=)\s*"([^"]*)"|(\bAND\b|\bOR\b)', query, re.IGNORECASE)
    if not tokens: return pd.Series([True] * len(df))
    final_mask = None
    last_logic = "AND"
    for token in tokens:
        if token[3]:
            last_logic = token[3].upper()
        else:
            col, op, val = token[0], token[1], token[2]
            current_mask = evaluate_simple_condition(col, op, val)
            if final_mask is None:
                final_mask = current_mask
            else:
                if last_logic == "AND": final_mask &= current_mask
                else: final_mask |= current_mask
    return final_mask if final_mask is not None else pd.Series([True] * len(df))

def apply_jql(df, query):
    if not query: return df
    try:
        clean_query = re.sub(r'^COUNT\s*\((.*)\)$', r'\1', query, flags=re.IGNORECASE).strip()
        mask = parse_jql_to_mask(df, clean_query)
        return df[mask]
    except Exception as e:
        print(f"JQL Error: {e}")
        return df

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    file = request.files.get('file')
    session_id = request.form.get('session_id') or str(uuid.uuid4())
    
    if not file: return jsonify({"error": "Nenhum arquivo"}), 400
    
    start_time = time.time()
    file_ext = os.path.splitext(file.filename)[1].lower()
    
    sheet_name = request.form.get('sheet_name')
    
    if file_ext == '.csv':
        df = pd.read_csv(file, engine='pyarrow', dtype_backend='pyarrow')
    elif file_ext == '.xlsx':
        xl = pd.ExcelFile(file)
        sheets = xl.sheet_names
        if len(sheets) > 1 and not sheet_name:
            return jsonify({"multi_sheet": True, "sheets": sheets, "session_id": session_id})
        
        target_sheet = sheet_name if sheet_name in sheets else sheets[0]
        df = pd.read_excel(xl, sheet_name=target_sheet)
    elif file_ext == '.parquet':
        df = pd.read_parquet(file, engine='pyarrow')
    else:
        return jsonify({"error": "Formato não suportado"}), 400

    for col in df.columns:
        if df[col].dtype == 'object' or 'string' in str(df[col].dtype):
            if df[col].nunique() < 50000:
                df[col] = df[col].astype('category')

    cache.set(session_id, df)
    
    import_time = time.time() - start_time
    options = {col: df[col].dropna().unique().astype(str).tolist()[:50] for col in df.columns}
    
    return jsonify({
        "columns": df.columns.tolist(), 
        "options": options, 
        "session_id": session_id,
        "import_time": f"{import_time:.3f}s",
        "is_parquet": file_ext == '.parquet'
    })

@app.route('/get_parquet', methods=['POST'])
def get_parquet():
    params = request.json
    session_id = params.get('session_id')
    df = cache.get(session_id)
    if df is None: return jsonify({"error": "Sessão expirada"}), 404
    
    out = io.BytesIO()
    df.to_parquet(out, index=False, engine='pyarrow')
    out.seek(0)
    return send_file(out, mimetype='application/octet-stream', as_attachment=True, download_name='converted.parquet')

@app.route('/fetch', methods=['POST'])
def fetch_data():
    params = request.json
    session_id = params.get('session_id')
    query = params.get('jql_query', "").strip()
    sort_col = params.get('sort_col')
    sort_dir = params.get('sort_dir', 'asc')
    
    df = cache.get(session_id)
    if df is None: return jsonify({"error": "Sessão expirada ou arquivo não carregado"}), 404
    
    start_time = time.time()
    df_filtered = apply_jql(df, query)
    
    if sort_col and sort_col in df_filtered.columns:
        df_filtered = df_filtered.sort_values(by=sort_col, ascending=(sort_dir == 'asc'))
        
    filter_time = time.time() - start_time
    
    total_count = len(df_filtered)
    page_size = 100
    page = int(params.get('page', 1))
    start = (page - 1) * page_size
    pdf = df_filtered.iloc[start:start + page_size].copy()
    
    for col in pdf.columns:
        if pdf[col].dtype.name == 'category':
            if "" not in pdf[col].cat.categories: pdf[col] = pdf[col].cat.add_categories("")
            pdf[col] = pdf[col].fillna("")
        else: pdf[col] = pdf[col].fillna("")
        
    return jsonify({
        "data": pdf.to_dict(orient='records'), 
        "total_count": total_count,
        "filter_time": f"{filter_time:.3f}s"
    })

@app.route('/analyze_column', methods=['POST'])
def analyze_column():
    params = request.json
    col = params.get('column')
    session_id = params.get('session_id')
    query = params.get('jql_query', "").strip()
    
    df = cache.get(session_id)
    if df is None: return jsonify({"error": "Sessão expirada"}), 404
    
    df_filtered = apply_jql(df, query)
    
    if col not in df_filtered.columns:
        return jsonify({"error": f"Coluna '{col}' não encontrada no arquivo atual"}), 400
        
    unique_count = int(df_filtered[col].nunique())
    counts = df_filtered[col].value_counts().head(50).to_dict()
    formatted_counts = [{"value": str(k), "count": int(v)} for k, v in counts.items()]
    
    return jsonify({
        "column": col, 
        "stats": formatted_counts, 
        "total_rows": len(df_filtered),
        "unique_values": unique_count
    })

@app.route('/delete_session', methods=['POST'])
def delete_session():
    params = request.json
    session_id = params.get('session_id')
    if session_id:
        cache.delete(session_id)
    return jsonify({"status": "ok"})

@app.route('/export', methods=['POST'])
def export():
    params = request.json
    session_id = params.get('session_id')
    query = params.get('jql_query', "").strip()
    
    df = cache.get(session_id)
    if df is None: return jsonify({"error": "Sessão expirada"}), 404
    
    df_filtered = apply_jql(df, query)
    
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df_filtered.to_excel(writer, index=False, sheet_name='Resultados')
    output.seek(0)
    return send_file(output, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', as_attachment=True, download_name=f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
