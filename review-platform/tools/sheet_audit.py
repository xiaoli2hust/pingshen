# -*- coding: utf-8 -*-
"""JSON-safe original values and bounded, sparse data_only worksheet display."""
import math
import re
from datetime import date, datetime, time


def raw_value(value):
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def display_value(cell):
    value = cell.value
    if value is None:
        return ''
    if isinstance(value, (date, datetime)):
        return value.strftime('%Y-%m-%d')
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            return ''
        # Ignore literal/escaped percent signs in custom Excel formats.
        fmt = re.sub(r'"[^"]*"|\\.', '', cell.number_format or '')
        percent = '%' in fmt
        number = value * 100 if percent else value
        text = format(number, '.15g')
        return text + '%' if percent else text
    return str(value)


def audit_sheet(ws):
    max_row, max_col = ws.max_row, ws.max_column
    cells = []
    for row in ws.iter_rows(max_row=min(max_row, 300), max_col=max_col):
        for cell in row:
            if cell.value is None:
                continue
            display = display_value(cell)
            if not display.strip():
                continue
            item = [cell.row - 1, cell.column - 1, display[:2000]]
            raw = raw_value(cell.value)
            if not isinstance(raw, str) or raw != item[2]:
                item.append(raw)
            cells.append(item)
    return {
        'name': ws.title, 'max_row': max_row, 'max_col': max_col,
        'truncated': max_row > 300, 'cells': cells,
        'merges': [[m.min_row - 1, m.min_col - 1, m.max_row - 1, m.max_col - 1]
                   for m in ws.merged_cells.ranges],
    }
