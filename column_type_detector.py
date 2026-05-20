"""
Módulo de detecção automática de tipos de coluna.
Analisa valores de cada coluna e classifica em: text, number, currency, date, boolean, percentage.
"""

import re
import pandas as pd


# --- Regex patterns ---

# Number patterns
_RE_INTEGER = re.compile(r'^-?\d+$')
_RE_DECIMAL_SIMPLE = re.compile(r'^-?\d+[.,]\d+$')
_RE_DECIMAL_BR = re.compile(r'^-?\d{1,3}(\.\d{3})*,\d+$')
_RE_DECIMAL_US = re.compile(r'^-?\d{1,3}(,\d{3})*\.\d+$')

# Currency patterns
_RE_CURRENCY_BR = re.compile(r'^R\$\s?\d{1,3}(\.\d{3})*,\d{2}$')
_RE_CURRENCY_US = re.compile(r'^\$\s?\d{1,3}(,\d{3})*\.\d{2}$')

# Date patterns
_RE_DATE_BR = re.compile(r'^\d{2}[/-]\d{2}[/-]\d{4}$')
_RE_DATE_ISO = re.compile(r'^\d{4}-\d{2}-\d{2}')
_RE_DATE_MMM = re.compile(r'^\d{2}-[A-Za-z]{3}-\d{4}$')

# Percentage pattern
_RE_PERCENTAGE = re.compile(r'^-?\d+([.,]\d+)?%$')

# Boolean sets
_BOOLEAN_SETS = [
    {'true', 'false'},
    {'sim', 'não'},
    {'yes', 'no'},
    {'0', '1'},
]

# Percentage column name indicators
_PERCENTAGE_INDICATORS = ['percent', 'pct', 'taxa', 'rate']


def _is_number(value: str) -> bool:
    """
    Verifica se o valor corresponde a padrão numérico.
    Suporta inteiros, decimais (ponto/vírgula), separadores de milhar BR/US.
    """
    value = value.strip()
    if _RE_INTEGER.match(value):
        return True
    if _RE_DECIMAL_BR.match(value):
        return True
    if _RE_DECIMAL_US.match(value):
        return True
    if _RE_DECIMAL_SIMPLE.match(value):
        return True
    return False


def _is_currency(value: str) -> bool:
    """
    Verifica se o valor corresponde a padrão monetário.
    Suporta R$ (formato brasileiro) e $ (formato americano), com ou sem espaço após símbolo.
    """
    value = value.strip()
    if _RE_CURRENCY_BR.match(value):
        return True
    if _RE_CURRENCY_US.match(value):
        return True
    return False


def _is_date(value: str) -> bool:
    """
    Verifica se o valor corresponde a um formato de data suportado.
    Formatos: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, dd-MMM-yyyy, ISO datetime.
    """
    value = value.strip()
    if _RE_DATE_BR.match(value):
        return True
    if _RE_DATE_ISO.match(value):
        return True
    if _RE_DATE_MMM.match(value):
        return True
    return False


def _is_boolean(value: str) -> bool:
    """
    Verifica se o valor pertence a um conjunto booleano reconhecido.
    Conjuntos: {true/false}, {sim/não}, {yes/no}, {0/1}.
    """
    normalized = value.strip().lower()
    for bool_set in _BOOLEAN_SETS:
        if normalized in bool_set:
            return True
    return False


def _is_percentage(value: str, col_name: str = '') -> bool:
    """
    Verifica se o valor é percentual.
    - Sufixo %: ex. 45%, 12.5%, -3,2%
    - Valores decimais entre 0 e 1 com nome de coluna indicativo (percent, pct, taxa, rate).
    """
    value = value.strip()
    if _RE_PERCENTAGE.match(value):
        return True
    # Verificar se é valor entre 0 e 1 com nome de coluna indicativo
    if col_name:
        col_lower = col_name.lower()
        has_indicator = any(ind in col_lower for ind in _PERCENTAGE_INDICATORS)
        if has_indicator:
            try:
                num = float(value.replace(',', '.'))
                if 0 <= num <= 1:
                    return True
            except (ValueError, TypeError):
                pass
    return False


def detect_single_column(series: pd.Series, col_name: str) -> str:
    """
    Detecta o tipo de uma única coluna baseado em amostragem.
    Amostra no máximo 100 valores não-nulos.
    Retorna o tipo detectado: 'text', 'number', 'currency', 'date', 'boolean', 'percentage'.
    """
    # Converter para string e remover nulos e strings vazias
    values = series.dropna().astype(str)
    values = values[values.str.strip() != '']

    # Se não há valores não-nulos, retornar "text"
    if len(values) == 0:
        return 'text'

    # Amostrar até 100 valores (Req 9.1, 9.2)
    if len(values) > 100:
        values = values.sample(n=100, random_state=42)

    # Classificar cada valor com ordem de prioridade:
    # currency > percentage > date > boolean > number > text
    type_counts = {
        'currency': 0,
        'percentage': 0,
        'date': 0,
        'boolean': 0,
        'number': 0,
        'text': 0,
    }

    for val in values:
        val_str = str(val).strip()
        if _is_currency(val_str):
            type_counts['currency'] += 1
        elif _is_percentage(val_str, col_name):
            type_counts['percentage'] += 1
        elif _is_date(val_str):
            type_counts['date'] += 1
        elif _is_boolean(val_str):
            type_counts['boolean'] += 1
        elif _is_number(val_str):
            type_counts['number'] += 1
        else:
            type_counts['text'] += 1

    # Aplicar regra de 70% (Req 1.3)
    total = len(values)
    threshold = 0.7

    for col_type, count in type_counts.items():
        if col_type == 'text':
            continue
        if count / total > threshold:
            return col_type

    return 'text'


def detect_column_types(df: pd.DataFrame) -> dict:
    """
    Analisa cada coluna do DataFrame e retorna um mapeamento {coluna: tipo}.
    Tipos possíveis: 'text', 'number', 'currency', 'date', 'boolean', 'percentage'
    """
    result = {}
    for col in df.columns:
        result[col] = detect_single_column(df[col], col)
    return result
