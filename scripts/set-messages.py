#!/usr/bin/env python3
"""Merge translation keys into BOTH message files at once, keeping their order.

    python3 scripts/set-messages.py Portal.Shared <<'EOF'
    { "my_key": { "ar": "...", "en": "..." } }
    EOF

Every user-visible string must exist in messages/ar.json AND messages/en.json
(CLAUDE.md); this makes adding one to only one of them impossible.
"""
import json, sys
ns = sys.argv[1].split(".")
new = json.load(sys.stdin)
for lang in ("ar", "en"):
    p = f"messages/{lang}.json"
    d = json.load(open(p, encoding="utf-8"))
    node = d
    for k in ns:
        node = node[k]
    added = changed = 0
    for key, val in new.items():
        if key not in node: added += 1
        elif node[key] != val[lang]: changed += 1
        node[key] = val[lang]
    json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    open(p, "a", encoding="utf-8").write("\n")
    print(lang, "added", added, "changed", changed)
