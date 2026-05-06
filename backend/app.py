import sys
from pathlib import Path

from flask import Flask, send_from_directory
from flask_cors import CORS

from .routes import api


def _find_frontend_dist() -> Path | None:
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)
    else:
        base = Path(__file__).resolve().parent.parent

    dist = base / "frontend" / "dist"
    if dist.is_dir() and (dist / "index.html").is_file():
        return dist
    return None


def create_app() -> Flask:
    dist_dir = _find_frontend_dist()

    if dist_dir is not None:
        app = Flask(
            __name__,
            static_folder=str(dist_dir / "assets"),
            static_url_path="/assets",
        )
    else:
        app = Flask(__name__)

    CORS(app)
    app.register_blueprint(api)

    if dist_dir is not None:

        @app.route("/", defaults={"path": ""})
        @app.route("/<path:path>")
        def serve_spa(path: str):
            file_path = dist_dir / path
            if path and file_path.is_file():
                return send_from_directory(str(dist_dir), path)
            return send_from_directory(str(dist_dir), "index.html")

    return app
