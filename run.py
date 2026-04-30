import os
import signal
import subprocess
import sys
import time
import webbrowser


def main():
    root = os.path.dirname(os.path.abspath(__file__))
    frontend_dir = os.path.join(root, "frontend")

    flask_proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "flask",
            "--app",
            "backend.app:create_app",
            "run",
            "--port",
            "5001",
        ],
        cwd=root,
    )

    vite_proc = subprocess.Popen(
        ["npx", "vite", "--port", "5173"],
        cwd=frontend_dir,
    )

    time.sleep(3)
    webbrowser.open("http://localhost:5173")

    def shutdown(sig, frame):
        flask_proc.terminate()
        vite_proc.terminate()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        flask_proc.wait()
    finally:
        flask_proc.terminate()
        vite_proc.terminate()


if __name__ == "__main__":
    main()
