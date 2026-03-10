"""
organize.py  --  GitHub Actions から呼ばれるファイル整理スクリプト

使い方:
  python organize.py move_file    '{"file":"html/foo.html","tag":"pasta"}'
  python organize.py rebuild_index '{}'
"""

import sys
import json
import os
import shutil
from pathlib import Path
from datetime import datetime, timezone, timedelta

ACTION  = sys.argv[1]
PAYLOAD = json.loads(sys.argv[2])

ROOT     = Path(".")
HTML_DIR = ROOT / "html"
JST      = timezone(timedelta(hours=9))


# ── index.html 生成 ──────────────────────────────────────────────────────────

def esc(s: str) -> str:
    return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;")

def build_folder_index(folder: Path, label: str) -> str:
    """フォルダ内の *.html（index.html 除く）一覧ページを生成"""
    files = sorted(
        [f for f in folder.glob("*.html") if f.name != "index.html"],
        reverse=True
    )
    rows = []
    for f in files:
        name    = f.stem
        display = name[20:].replace("_", " ") if len(name) > 20 else name.replace("_", " ")
        date    = name[:19].replace("T"," ").replace("-","/"  ,2).replace("-",":",2) if len(name) > 19 else ""
        rows.append(
            f'      <li>'
            f'<a href="./{esc(f.name)}">{esc(display)}</a>'
            f'<time>{esc(date)}</time>'
            f'</li>'
        )
    rows_html = "\n".join(rows)
    updated   = datetime.now(JST).strftime("%Y/%m/%d %H:%M:%S JST")

    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{esc(label)}</title>
  <style>
    *,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
    body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}}
    header{{padding:2rem 1.5rem 1.25rem;border-bottom:1px solid #1e293b;background:#0f172a;position:sticky;top:0;z-index:10}}
    header h1{{font-size:1.4rem;font-weight:700;color:#f8fafc}}
    header p{{margin-top:.3rem;font-size:.8rem;color:#64748b}}
    main{{max-width:860px;margin:0 auto;padding:1.5rem 1rem 4rem}}
    ul{{list-style:none;display:flex;flex-direction:column;gap:.5rem}}
    li{{display:flex;align-items:center;justify-content:space-between;gap:1rem;background:#1e293b;border-radius:.6rem;padding:.8rem 1.1rem;border:1px solid #243047;transition:background .15s}}
    li:hover{{background:#243047}}
    a{{color:#7dd3fc;text-decoration:none;font-weight:500;font-size:.95rem;flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}}
    a:hover{{color:#38bdf8;text-decoration:underline}}
    time{{font-size:.75rem;color:#475569;white-space:nowrap}}
    .back{{display:inline-block;margin-bottom:1rem;font-size:.85rem;color:#94a3b8;text-decoration:none}}
    .back:hover{{color:#cbd5e1}}
  </style>
</head>
<body>
  <header>
    <h1>📁 {esc(label)} <span style="font-size:.8rem;background:#1d4ed8;color:#bfdbfe;padding:.1rem .5rem;border-radius:999px;margin-left:.4rem">{len(files)}</span></h1>
    <p>最終更新: {esc(updated)}</p>
  </header>
  <main>
    <a class="back" href="../../index.html">← ホームに戻る</a>
    <ul>
{rows_html}
    </ul>
  </main>
</body>
</html>"""


def build_top_index() -> str:
    """ルートの index.html：フォルダ一覧 + html/ 直下の未分類ファイル"""
    updated = datetime.now(JST).strftime("%Y/%m/%d %H:%M:%S JST")

    # タグフォルダ（html/ と同階層、hidden除く）
    tag_folders = sorted([
        d for d in ROOT.iterdir()
        if d.is_dir() and not d.name.startswith(".") and d.name not in ("html", "scripts", "node_modules")
    ])

    folder_items = []
    for d in tag_folders:
        count = len([f for f in d.glob("*.html") if f.name != "index.html"])
        folder_items.append(
            f'<li class="folder-item">'
            f'<a href="./{esc(d.name)}/index.html">📁 {esc(d.name)}</a>'
            f'<span class="badge">{count}</span>'
            f'</li>'
        )

    # html/ 直下の未分類
    untagged = sorted(
        [f for f in HTML_DIR.glob("*.html") if f.name != "index.html"],
        reverse=True
    )
    untagged_items = []
    for f in untagged:
        name    = f.stem
        display = name[20:].replace("_", " ") if len(name) > 20 else name.replace("_", " ")
        date    = name[:19].replace("T"," ").replace("-","/"  ,2).replace("-",":",2) if len(name) > 19 else ""
        untagged_items.append(
            f'<li>'
            f'<a href="./html/{esc(f.name)}">{esc(display)}</a>'
            f'<time>{esc(date)}</time>'
            f'</li>'
        )

    folders_html  = "\n".join(folder_items)  if folder_items  else "<li style='color:#475569;padding:.5rem'>フォルダなし</li>"
    untagged_html = "\n".join(untagged_items) if untagged_items else "<li style='color:#475569;padding:.5rem'>未分類ファイルなし</li>"

    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Evernote</title>
  <style>
    *,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
    body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}}
    header{{padding:2rem 1.5rem 1.25rem;border-bottom:1px solid #1e293b;background:#0f172a;position:sticky;top:0;z-index:10}}
    header h1{{font-size:1.5rem;font-weight:700;color:#f8fafc}}
    header p{{margin-top:.3rem;font-size:.8rem;color:#64748b}}
    main{{max-width:860px;margin:0 auto;padding:1.5rem 1rem 4rem;display:flex;flex-direction:column;gap:2rem}}
    section h2{{font-size:1rem;font-weight:600;color:#94a3b8;letter-spacing:.08em;text-transform:uppercase;margin-bottom:.75rem}}
    ul{{list-style:none;display:flex;flex-direction:column;gap:.5rem}}
    li{{display:flex;align-items:center;justify-content:space-between;gap:1rem;background:#1e293b;border-radius:.6rem;padding:.8rem 1.1rem;border:1px solid #243047;transition:background .15s}}
    li:hover{{background:#243047}}
    a{{color:#7dd3fc;text-decoration:none;font-weight:500;font-size:.95rem;flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}}
    a:hover{{color:#38bdf8;text-decoration:underline}}
    time{{font-size:.75rem;color:#475569;white-space:nowrap}}
    .badge{{font-size:.7rem;background:#1d4ed8;color:#bfdbfe;padding:.1rem .5rem;border-radius:999px;white-space:nowrap}}
    .folder-item a{{color:#a5b4fc}}
    .folder-item a:hover{{color:#c7d2fe}}
  </style>
</head>
<body>
  <header>
    <h1>🗂 My Evernote</h1>
    <p>最終更新: {esc(updated)}</p>
  </header>
  <main>
    <section>
      <h2>📁 タグフォルダ</h2>
      <ul>{folders_html}</ul>
    </section>
    <section>
      <h2>📄 未分類</h2>
      <ul>{untagged_html}</ul>
    </section>
  </main>
</body>
</html>"""


# ── アクション ────────────────────────────────────────────────────────────────

def action_move_file():
    """html/foo.html → <tag>/foo.html に移動し、各 index を再生成"""
    src_rel = PAYLOAD["file"]   # 例: "html/foo.html"
    tag     = PAYLOAD["tag"]    # 例: "pasta"

    src  = ROOT / src_rel
    dest_dir = ROOT / tag
    dest_dir.mkdir(exist_ok=True)
    dest = dest_dir / src.name

    shutil.move(str(src), str(dest))
    print(f"moved: {src} → {dest}")

    # タグフォルダの index を更新
    (dest_dir / "index.html").write_text(build_folder_index(dest_dir, tag), encoding="utf-8")

    # html/ の index も更新
    (HTML_DIR / "index.html").write_text(build_folder_index(HTML_DIR, "html"), encoding="utf-8")

    # トップ index 更新
    (ROOT / "index.html").write_text(build_top_index(), encoding="utf-8")


def action_rebuild_index():
    """全 index.html を再生成するだけ"""
    # html/
    (HTML_DIR / "index.html").write_text(build_folder_index(HTML_DIR, "html"), encoding="utf-8")

    # タグフォルダ
    for d in ROOT.iterdir():
        if d.is_dir() and not d.name.startswith(".") and d.name not in ("html", "scripts"):
            (d / "index.html").write_text(build_folder_index(d, d.name), encoding="utf-8")

    # トップ
    (ROOT / "index.html").write_text(build_top_index(), encoding="utf-8")
    print("rebuilt all indexes")


# ── エントリポイント ──────────────────────────────────────────────────────────

if ACTION == "move_file":
    action_move_file()
elif ACTION == "rebuild_index":
    action_rebuild_index()
else:
    print(f"unknown action: {ACTION}", file=sys.stderr)
    sys.exit(1)
