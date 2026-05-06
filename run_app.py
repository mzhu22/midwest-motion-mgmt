"""Entry point for the bundled executable. Starts Flask and opens browser."""

import socket
import threading
import webbrowser

from backend.app import create_app

PORT = 5001


def _wait_and_open_browser():
    for _ in range(40):
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=0.5):
                break
        except OSError:
            pass
    webbrowser.open(f"http://localhost:{PORT}")


def main():
    threading.Thread(target=_wait_and_open_browser, daemon=True).start()
    app = create_app()
    app.run(host="127.0.0.1", port=PORT, use_reloader=False)


if __name__ == "__main__":
    main()
