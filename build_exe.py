"""Build the Windows executable. Requires Node.js and uv on PATH."""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"


def run(cmd: list[str], **kwargs) -> None:
    print(f">>> {' '.join(cmd)}")
    subprocess.run(cmd, check=True, **kwargs)


def main() -> None:
    print("=== Building frontend ===")
    run(["npm", "ci"], cwd=FRONTEND)
    run(["npm", "run", "build"], cwd=FRONTEND)

    dist = FRONTEND / "dist"
    if not (dist / "index.html").is_file():
        print("ERROR: frontend build did not produce dist/index.html")
        sys.exit(1)

    print("\n=== Installing Python dependencies ===")
    run(["uv", "sync", "--group", "build"])

    print("\n=== Running PyInstaller ===")
    run(["uv", "run", "pyinstaller", "midwest_motion.spec", "--noconfirm"])

    output = ROOT / "dist" / "MidwestMotionMgmt"
    if output.is_dir():
        print(f"\nBuild complete: {output}")
    else:
        print("ERROR: PyInstaller did not produce expected output")
        sys.exit(1)


if __name__ == "__main__":
    main()
