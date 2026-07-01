import os

file_path = r"c:\Users\Administrator\Documents\bitrow-main\node_modules\lightweight-charts\dist\lightweight-charts.development.mjs"

if not os.path.exists(file_path):
    print("File not found:", file_path)
    exit()

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's search for keywords
keywords = ["button", "svg", "path", "zoom", "reset", "navigation", "reload", "circle"]
for kw in keywords:
    count = content.lower().count(kw)
    print(f"Keyword '{kw}': {count} occurrences")

# Let's search for potential class name structures
import re
classes = re.findall(r'class[a-zA-Z0-9_-]*|["\'][a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+["\']', content)
print("Total potential classes/identifiers:", len(classes))
for cl in set(classes)[:30]:
    print("Class/ID sample:", cl)
