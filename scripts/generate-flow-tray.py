"""Render desktop tray variants from the supplied VMNTe vector silhouette.

Run with Python 3 and Bun. Uses Tauri's icon renderer, no imaging dependencies.
The first path in Group 15511.svg contains the wedge and its star cutout.
"""
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import shutil

ROOT = Path(__file__).resolve().parent.parent
source = ET.parse(ROOT / "brand/Group 15511.svg").getroot()
path = source.find("{http://www.w3.org/2000/svg}path").attrib["d"]

with tempfile.TemporaryDirectory(prefix="flow-tray-") as temp:
    temp = Path(temp)
    for suffix, color in [("", "#ffffff"), ("_dark", "#000000"), ("_color", "#367bea")]:
        for state in ["idle", "recording", "transcribing", "idle_warning"]:
            badge = ""
            if state != "idle":
                badge = '<circle cx="25" cy="25" r="6" fill="#f1f1f1"/>'
                if state == "recording":
                    badge += '<circle cx="25" cy="25" r="4" fill="#000000"/>'
                elif state == "transcribing":
                    badge += '<path d="M22 25h6M25 22v6" stroke="#000000" stroke-width="1.8" stroke-linecap="round"/>'
                else:
                    badge += '<path d="M25 21.5v4M25 28v.2" stroke="#000000" stroke-width="1.8" stroke-linecap="round"/>'
            svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="{path}" fill="{color}" fill-rule="evenodd" transform="translate(3 7) scale(.029)"/>{badge}</svg>'
            input_path = temp / "tray.svg"
            input_path.write_text(svg)
            subprocess.run(["bun", "run", "tauri", "icon", str(input_path), "--png", "32", "--output", str(temp / "out")], cwd=ROOT, check=True, capture_output=True)
            if suffix == "_color":
                name = {"idle": "handy", "idle_warning": "handy_warning", "recording": "recording", "transcribing": "transcribing"}[state]
            else:
                name = f"tray_{state}{suffix}"
            shutil.copyfile(temp / "out/32x32.png", ROOT / f"src-tauri/resources/{name}.png")
            print(name)
