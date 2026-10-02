import io
import docx2txt
from pypdf import PdfReader
import pandas as pd
from typing import List, Dict, Any

def document_text(filename: str, content_bytes: bytes) -> str:
    size = len(content_bytes)
    if size > 10 * 1024 * 1024:
        raise Exception("Maximum file size is 10 MB.")

    ext = filename.lower().split('.')[-1]
    content = ""

    if ext == "docx":
        content = docx2txt.process(io.BytesIO(content_bytes))
    elif ext == "pdf":
        reader = PdfReader(io.BytesIO(content_bytes))
        for page in reader.pages:
            text = page.extract_text()
            if text:
                content += text + "\n"
    elif ext in ["txt", "md"]:
        content = content_bytes.decode('utf-8', errors='ignore')
    else:
        raise Exception("Upload a PDF, DOCX, TXT, or Markdown document.")

    if not content.strip():
        raise Exception("No readable text found. Scanned documents require OCR before upload.")

    if len(content) > 150000:
        raise Exception("This document is too long. Split it into documents under 150,000 characters.")

    return content

def test_rows(filename: str, content_bytes: bytes) -> List[Dict[str, str]]:
    size = len(content_bytes)
    if size > 10 * 1024 * 1024:
        raise Exception("Maximum file size is 10 MB.")

    ext = filename.lower().split('.')[-1]

    if ext == "csv":
        df = pd.read_csv(io.BytesIO(content_bytes))
    elif ext == "xlsx":
        df = pd.read_excel(io.BytesIO(content_bytes), engine='openpyxl')
    else:
        raise Exception("Upload an XLSX or CSV test file.")

    # Lowercase headers
    df.columns = [str(c).strip().lower() for c in df.columns]

    # Drop rows where all elements are NaN
    df = df.dropna(how='all')

    # Replace nan with empty string
    df = df.fillna("")

    # Convert to dict records
    records = df.to_dict('records')

    return [{str(k): str(v) for k, v in record.items()} for record in records]
