# Extracts the article body of a Sphinx manual page as plain text.
import sys, re, html, pathlib
src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
for f in src.glob("*.html"):
    t = f.read_text(encoding="utf-8")
    m = re.search(r'<article[^>]*role="main"[^>]*>(.*?)</article>', t, re.S) or re.search(r'<article[^>]*>(.*?)</article>', t, re.S)
    body = m.group(1) if m else t
    body = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', body, flags=re.S)
    body = re.sub(r'<(h\d|p|li|dt|dd|div|tr|br)[^>]*>', '\n', body)
    body = html.unescape(re.sub(r'<[^>]+>', '', body))
    body = re.sub(r'\n\s*\n+', '\n', body)
    (dst / (f.stem + ".txt")).write_text(body.strip(), encoding="utf-8")
