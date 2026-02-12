from flask import Flask, render_template, request, jsonify, send_file
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import os
import re
import io
import json
from datetime import datetime

app = Flask(__name__)
UPLOAD_FOLDER = 'uploads'
METADATA_FILE = os.path.join(UPLOAD_FOLDER, 'metadata.json')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

current_df = None
current_filename = None

def get_metadata():
    if os.path.exists(METADATA_FILE):
        try:
            with open(METADATA_FILE, 'r') as f:
                return json.load(f)
        except: return {}
    return {}

def save_metadata(metadata):
    with open(METADATA_FILE, 'w') as f:
        json.dump(metadata, f)

def get_parquet_history():
    if not os.path.exists(UPLOAD_FOLDER): return []
    history = []
    metadata = get_metadata()
    for f in os.listdir(UPLOAD_FOLDER):
        if f.endswith('.parquet'):
            path = os.path.join(UPLOAD_FOLDER, f)
            stats = os.stat(path)
            history.append({
                "filename": f,
                "label": metadata.get(f, f),
                "size": f"{stats.st_size / (1024*1024):.2f} MB",
                "date": datetime.fromtimestamp(stats.st_ctime).strftime('%d/%m/%Y %H:%M'),
                "timestamp": stats.st_ctime
            })
    return sorted(history, key=lambda x: x['timestamp'], reverse=True)

def apply_jql(df, query):
    if not query: return df
    clean_query = re.sub(r'^COUNT\s*\((.*)\)$', r'\1', query, flags=re.IGNORECASE).strip()
    tokens = re.findall(r'(\w+)\s*([=~])\s*"([^"]*)"|(\bAND\b|\bOR\b)', clean_query, re.IGNORECASE)
    if not tokens: return df
    final_mask = None
    last_logic = "AND"
    for token in tokens:
        if token[3]: 
            last_logic = token[3].upper()
        else:
            col, op, val = token[0], token[1], token[2]
            if col not in df.columns: continue
            if op == "=":
                current_mask = (df[col].astype(str) == val)
            else: 
                current_mask = (df[col].astype(str).str.contains(val, case=False, na=False))
            if final_mask is None:
                final_mask = current_mask
            else:
                if last_logic == "AND": final_mask &= current_mask
                else: final_mask |= current_mask
    return df[final_mask] if final_mask is not None else df

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/history', methods=['GET'])
def history():
    return jsonify(get_parquet_history())

@app.route('/update_label', methods=['POST'])
def update_label():
    params = request.json
    filename = params.get('filename')
    new_label = params.get('label')
    if not filename: return jsonify({"status": "error"}), 400
    meta = get_metadata()
    meta[filename] = new_label
    save_metadata(meta)
    return jsonify({"status": "ok"})

@app.route('/delete_file', methods=['POST'])
def delete_file():
    params = request.json
    filename = params.get('filename')
    path = os.path.join(UPLOAD_FOLDER, filename)
    if os.path.exists(path):
        os.remove(path)
        meta = get_metadata()
        if filename in meta:
            del meta[filename]
            save_metadata(meta)
        return jsonify({"status": "ok"})
    return jsonify({"status": "error"}), 404

@app.route('/upload', methods=['POST'])
def upload():
    global current_df, current_filename
    file = request.files.get('file')
    target_filename = request.form.get('filename')
    if file:
        base_name = os.path.splitext(file.filename)[0]
        parquet_path = os.path.join(UPLOAD_FOLDER, f"{base_name}.parquet")
        if not os.path.exists(parquet_path):
            temp_csv = os.path.join(UPLOAD_FOLDER, file.filename)
            file.save(temp_csv)
            reader = pd.read_csv(temp_csv, chunksize=500000, low_memory=False)
            writer = None
            for chunk in reader:
                table = pa.Table.from_pandas(chunk)
                if writer is None: writer = pq.ParquetWriter(parquet_path, table.schema)
                writer.write_table(table)
            if writer: writer.close()
            os.remove(temp_csv)
        current_filename = f"{base_name}.parquet"
    else:
        current_filename = target_filename
    if not current_filename: return jsonify({"error": "Nenhum arquivo"}), 400
    path = os.path.join(UPLOAD_FOLDER, current_filename)
    current_df = pd.read_parquet(path)
    for col in current_df.columns:
        if current_df[col].nunique() < 100000:
            current_df[col] = current_df[col].astype('category')
    options = {col: current_df[col].dropna().unique().astype(str).tolist()[:50] for col in current_df.columns}
    return jsonify({"columns": current_df.columns.tolist(), "options": options, "filename": current_filename})

@app.route('/fetch', methods=['POST'])
def fetch_data():
    global current_df
    params = request.json
    page = int(params.get('page', 1))
    query = params.get('jql_query', "").strip()
    sort_col = params.get('sort_col')
    sort_dir = params.get('sort_dir', 'asc')
    df = apply_jql(current_df, query)
    if sort_col and sort_col in df.columns:
        df = df.sort_values(by=sort_col, ascending=(sort_dir == 'asc'))
    total_count = len(df)
    page_size = 100
    start = (page - 1) * page_size
    pdf = df.iloc[start:start + page_size].copy()
    for col in pdf.columns:
        if pdf[col].dtype.name == 'category':
            if "" not in pdf[col].cat.categories: pdf[col] = pdf[col].cat.add_categories("")
            pdf[col] = pdf[col].fillna("")
        else: pdf[col] = pdf[col].fillna("")
    return jsonify({"data": pdf.to_dict(orient='records'), "total_count": total_count})

@app.route('/analyze_column', methods=['POST'])
def analyze_column():
    global current_df
    params = request.json
    col = params.get('column')
    query = params.get('jql_query', "").strip()
    df = apply_jql(current_df, query)
    counts = df[col].value_counts().head(50).to_dict()
    formatted_counts = [{"value": str(k), "count": int(v)} for k, v in counts.items()]
    return jsonify({"column": col, "stats": formatted_counts, "total_rows": len(df)})

@app.route('/export', methods=['POST'])
def export():
    global current_df
    params = request.json
    query = params.get('jql_query', "").strip()
    df_filtered = apply_jql(current_df, query)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df_filtered.to_excel(writer, index=False, sheet_name='Resultados')
    output.seek(0)
    return send_file(output, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', as_attachment=True, download_name=f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx")

if __name__ == '__main__':
    app.run(debug=True, port=5001)