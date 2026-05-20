"""
Módulo de ordenação tipada (Sort Engine).
Converte valores de colunas para sort keys adequadas ao tipo detectado,
permitindo ordenação semanticamente correta.
"""

import re
import math
from datetime import datetime

import pandas as pd
import numpy as np


def _parse_number(value: str) -> float | None:
    """
    Converte string numérica para float, tratando separadores BR e US.
    Retorna None se não for possível converter.
    """
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    if not value:
        return None

    try:
        # Detectar formato brasileiro: 1.234,56 (ponto como milhar, vírgula como decimal)
        if re.match(r'^-?\d{1,3}(\.\d{3})*,\d+$', value):
            cleaned = value.replace('.', '').replace(',', '.')
            return float(cleaned)

        # Detectar formato americano: 1,234.56 (vírgula como milhar, ponto como decimal)
        if re.match(r'^-?\d{1,3}(,\d{3})*\.\d+$', value):
            cleaned = value.replace(',', '')
            return float(cleaned)

        # Decimal simples com vírgula: 3,14
        if re.match(r'^-?\d+,\d+$', value):
            cleaned = value.replace(',', '.')
            return float(cleaned)

        # Inteiro ou decimal simples com ponto
        return float(value)
    except (ValueError, TypeError):
        return None


def _parse_currency(value: str) -> float | None:
    """
    Remove símbolo monetário e converte para float.
    Suporta R$, $, €.
    """
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    if not value:
        return None

    # Remover símbolos monetários e espaços adjacentes
    cleaned = re.sub(r'^(R\$|€|\$)\s*', '', value)
    cleaned = cleaned.strip()

    if not cleaned:
        return None

    return _parse_number(cleaned)


def _parse_date(value: str) -> float | None:
    """
    Tenta parsear data em múltiplos formatos suportados.
    Retorna timestamp (float) para ordenação cronológica, ou None se falhar.
    """
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    if not value:
        return None

    formats = [
        '%d/%m/%Y',          # dd/mm/yyyy
        '%d-%m-%Y',          # dd-mm-yyyy
        '%Y-%m-%d',          # yyyy-mm-dd (ISO)
        '%Y-%m-%dT%H:%M:%S', # ISO datetime
        '%Y-%m-%d %H:%M:%S', # ISO datetime com espaço
        '%d-%b-%Y',          # dd-MMM-yyyy (ex: 15-Jan-2024)
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(value[:len(value)], fmt)
            return dt.timestamp()
        except (ValueError, TypeError):
            continue

    # Tentar ISO com timezone ou milissegundos (truncar)
    try:
        # Tratar formatos como 2024-01-15T10:30:00.000Z
        clean = value.split('.')[0].replace('Z', '')
        if 'T' in clean:
            dt = datetime.strptime(clean, '%Y-%m-%dT%H:%M:%S')
            return dt.timestamp()
    except (ValueError, TypeError):
        pass

    return None


def _parse_boolean(value: str) -> int | None:
    """
    Converte booleano para 0 (false) ou 1 (true).
    Retorna None se o valor não for reconhecido como booleano.
    """
    if not isinstance(value, str):
        value = str(value)
    normalized = value.strip().lower()

    true_values = {'true', 'sim', 'yes', '1'}
    false_values = {'false', 'não', 'no', '0'}

    if normalized in true_values:
        return 1
    if normalized in false_values:
        return 0
    return None


def _parse_percentage(value: str) -> float | None:
    """
    Extrai valor numérico de percentual.
    Remove sufixo % e converte para float.
    """
    if not isinstance(value, str):
        value = str(value)
    value = value.strip()
    if not value:
        return None

    # Remover sufixo %
    if value.endswith('%'):
        cleaned = value[:-1].strip()
        return _parse_number(cleaned)

    # Tentar como valor decimal direto (0-1)
    return _parse_number(value)


def get_sort_key(series: pd.Series, col_type: str) -> pd.Series:
    """
    Retorna uma Series com valores convertidos para ordenação correta.
    Valores não-convertíveis recebem NaN (ficam ao final com na_position='last').

    Args:
        series: Coluna do DataFrame a ser ordenada.
        col_type: Tipo detectado da coluna ('number', 'currency', 'date',
                  'boolean', 'percentage', 'text').

    Returns:
        Series com sort keys numéricas (ou string lowercase para texto).
    """
    if col_type == 'text':
        return series.astype(str).str.lower()

    # Mapeamento de tipo para parser correspondente
    parsers = {
        'number': _parse_number,
        'currency': _parse_currency,
        'date': _parse_date,
        'boolean': _parse_boolean,
        'percentage': _parse_percentage,
    }

    parser = parsers.get(col_type)
    if parser is None:
        # Tipo desconhecido: fallback para ordenação textual
        return series.astype(str).str.lower()

    # Aplicar parser a cada valor, convertendo None para NaN
    def apply_parser(val):
        if pd.isna(val):
            return np.nan
        result = parser(str(val))
        if result is None:
            return np.nan
        return result

    return series.apply(apply_parser)
