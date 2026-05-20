from flask import Flask, render_template, request, jsonify, send_file
import pandas as pd
import os
import re
import io
import time
import uuid
import hashlib
import json
from datetime import datetime
from sort_engine import get_sort_key
from column_type_detector import detect_column_types

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", str(uuid.uuid4()))

sessions = {}
SESSION_TTL = 8 * 3600  # 8 Horas

def get_user_id():
    """Gera um hash baseado no IP e User-Agent para vincular a sessão ao navegador."""
    ip = request.remote_addr or "unknown"
    ua = request.headers.get('User-Agent', 'unknown')
    return hashlib.sha256(f"{ip}_{ua}".encode()).hexdigest()

def clean_expired_sessions():
    now = time.time()
    to_delete = [sid for sid, data in sessions.items() if now - data['created'] > SESSION_TTL]
    for sid in to_delete:
        print(f"[*] SESSÃO EXPIRADA: {sid[:8]}...")
        sessions.pop(sid, None)

def get_session_data(session_id):
    clean_expired_sessions()
    data = sessions.get(session_id)
    if not data or data['user_id'] != get_user_id():
        return None
    return data

def set_session_data(session_id, df, column_types=None):
    sessions[session_id] = {
        "df": df,
        "column_types": column_types or {},
        "user_id": get_user_id(),
        "created": time.time()
    }

def parse_jql_to_mask(df, query):
    if not query: return pd.Series([True] * len(df))
    query = query.strip()
    
    def evaluate_simple_condition(col, op, val):
        if col not in df.columns: return pd.Series([False] * len(df))
        series_str = df[col].astype(str).replace(['None', 'nan', '<NA>'], '')
        val = str(val)
        if op == "=": return (series_str == val)
        elif op == "~": return (series_str.str.contains(val, case=False, na=False))
        elif op == "!~": return ~(series_str.str.contains(val, case=False, na=False))
        return pd.Series([True] * len(df))

    tokens = re.findall(r'([\w\.\-]+)\s*(!?~|=)\s*"([^"]*)"|(\bAND\b|\bOR\b)', query, re.IGNORECASE)
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
    filename = file.filename
    file_ext = os.path.splitext(filename)[1].lower()
    
    try:
        if file_ext == '.csv':
            try:
                df = pd.read_csv(file, engine='pyarrow')
            except:
                file.seek(0)
                df = pd.read_csv(file, low_memory=False)
        
        elif file_ext == '.xlsx':
            xl = pd.ExcelFile(file)
            sheets = xl.sheet_names
            sheet_name = request.form.get('sheet_name')
            if len(sheets) > 1 and not sheet_name:
                return jsonify({"multi_sheet": True, "sheets": sheets, "session_id": session_id})
            target_sheet = sheet_name if sheet_name in sheets else sheets[0]
            df = pd.read_excel(xl, sheet_name=target_sheet)
        
        elif file_ext == '.parquet':
            df = pd.read_parquet(file, engine='pyarrow')
        
        elif file_ext == '.json':
            content = file.read().decode('utf-8')
            try:
                # Tenta carregar como lista de dicts
                raw_data = json.loads(content)
                # O segredo: sep='.' faz o chavepai.chavefilho
                df = pd.json_normalize(raw_data, sep='.')
            except json.JSONDecodeError:
                # Se falhar, tenta JSON Lines (comum em logs da AWS)
                lines = [json.loads(line) for line in content.strip().split('\n')]
                df = pd.json_normalize(lines, sep='.')
        
        elif file_ext == '.xml':
            df = pd.read_xml(file)
            
        else:
            return jsonify({"error": f"Extensão {file_ext} não suportada"}), 400

        # Pós-processamento: Tratar colunas que ainda restaram como listas/objetos após o normalize
        for col in df.columns:
            if df[col].dtype == 'object':
                # Converte o que sobrar de complexo em string para o frontend não bugar
                df[col] = df[col].apply(lambda x: json.dumps(x) if isinstance(x, (dict, list)) else x)
                df[col] = df[col].astype(str).str.strip().replace(['', 'nan', 'None', 'NaN'], None)
                
                # Otimização de cardinalidade
                cardinality = df[col].nunique()
                if cardinality < (len(df) * 0.1) and cardinality < 5000:
                    df[col] = df[col].astype('category')

        column_types = detect_column_types(df)
        set_session_data(session_id, df, column_types)
        import_time = time.time() - start_time
        
        options = {col: df[col].dropna().unique().astype(str).tolist()[:50] for col in df.columns}
        
        metadata = {
            "columns": df.columns.tolist(),
            "options": options,
            "session_id": session_id,
            "import_time": f"{import_time:.3f}s",
            "is_parquet": True,
            "column_types": column_types
        }
        
        out = io.BytesIO()
        df.to_parquet(out, index=False, engine='pyarrow', compression='snappy')
        total_size = out.tell()
        out.seek(0)
        
        response = send_file(out, mimetype='application/octet-stream')
        response.headers['X-Log-Metadata'] = json.dumps(metadata)
        return response

    except Exception as e:
        print(f"[!] Erro no processamento: {str(e)}")
        return jsonify({"error": f"Falha ao processar arquivo: {str(e)}"}), 500

@app.route('/fetch', methods=['POST'])
def fetch_data():
    params = request.json
    session_id = params.get('session_id')
    query = params.get('jql_query', "").strip()
    sort_col = params.get('sort_col')
    sort_dir = params.get('sort_dir', 'asc')
    
    session_data = get_session_data(session_id)
    if session_data is None: return jsonify({"error": "Sessão expirada"}), 404
    df = session_data["df"]
    
    start_time = time.time()
    df_filtered = apply_jql(df, query)
    
    if sort_col and sort_col in df_filtered.columns:
        col_type = session_data.get("column_types", {}).get(sort_col, "text")
        sort_key = get_sort_key(df_filtered[sort_col], col_type)
        ascending = (sort_dir != 'desc')
        df_filtered = df_filtered.assign(_sort_key=sort_key).sort_values(
            by='_sort_key', ascending=ascending, na_position='last'
        ).drop(columns=['_sort_key'])
        
    filter_time = time.time() - start_time
    total_count = len(df_filtered)
    page_size = 100
    page = int(params.get('page', 1))
    start = (page - 1) * page_size
    pdf = df_filtered.iloc[start:start + page_size].copy()
    
    for col in pdf.columns:
        if hasattr(pdf[col], 'cat'):
            if "" not in pdf[col].cat.categories:
                pdf[col] = pdf[col].cat.add_categories("")
            pdf[col] = pdf[col].fillna("")
        else:
            pdf[col] = pdf[col].fillna("")
        
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
    
    session_data = get_session_data(session_id)
    if session_data is None: return jsonify({"error": "Sessão expirada"}), 404
    df = session_data["df"]
    
    df_filtered = apply_jql(df, query)
    
    if col not in df_filtered.columns:
        return jsonify({"error": f"Coluna '{col}' não encontrada"}), 400
        
    unique_count = int(df_filtered[col].nunique())
    counts = df_filtered[col].value_counts().head(50).to_dict()
    formatted_counts = [{"value": str(k), "count": int(v)} for k, v in counts.items()]
    
    return jsonify({
        "column": col, 
        "stats": formatted_counts, 
        "total_rows": len(df_filtered),
        "unique_values": unique_count
    })

@app.route('/export', methods=['POST'])
def export():
    params = request.json
    session_id = params.get('session_id')
    query = params.get('jql_query', "").strip()
    session_data = get_session_data(session_id)
    if session_data is None: return jsonify({"error": "Sessão expirada"}), 404
    df = session_data["df"]
    
    df_filtered = apply_jql(df, query)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df_filtered.to_excel(writer, index=False, sheet_name='Resultados')
    output.seek(0)
    return send_file(output, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', as_attachment=True, download_name=f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx")

@app.route('/export_distribution', methods=['POST'])
def export_distribution():
    params = request.json
    col = params.get('column')
    session_id = params.get('session_id')
    query = params.get('jql_query', "").strip()
    
    session_data = get_session_data(session_id)
    if session_data is None: return jsonify({"error": "Sessão expirada"}), 404
    df = session_data["df"]
    
    df_filtered = apply_jql(df, query)
    if col not in df_filtered.columns:
        return jsonify({"error": f"Coluna '{col}' não encontrada"}), 400
        
    # Exporta apenas a coluna selecionada do DataFrame filtrado
    column_data = df_filtered[[col]]
    
    output = io.BytesIO()
    column_data.to_csv(output, index=False, encoding='utf-8-sig')
    output.seek(0)
    
    filename = f"coluna_{col}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return send_file(output, mimetype='text/csv', as_attachment=True, download_name=filename)

@app.route('/delete_session', methods=['POST'])
def delete_session():
    params = request.json
    session_id = params.get('session_id')
    if session_id in sessions:
        sessions.pop(session_id, None)
    return jsonify({"status": "ok"})

if __name__ == '__main__':
    is_debug = os.environ.get("FLASK_ENV") == "development"
    app.run(host='0.0.0.0', port=5001, debug=is_debug)