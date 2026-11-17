"""Run the API and the web app together, without nginx, for development and the browser tests.

    WALLY_DATA=/tmp/wally DEMO=true python -m uvicorn utils.dev_server:app --port 8080
"""
import re
from pathlib import Path

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles

from api.main import app as api_app

class SinglePageApp(StaticFiles):
    """Every path without a file extension is the app's one page, as nginx serves it."""
    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as error:
            if error.status_code == 404 and "." not in path.rsplit("/", 1)[-1]:
                return await super().get_response("index.html", scope)
            raise

# The same Content-Security-Policy nginx sends with the app, so the browser tests run under it
_NGINX = (Path(__file__).resolve().parent.parent / "nginx.conf").read_text()
CSP = re.search(r'^    add_header Content-Security-Policy "([^"]+)" always;', _NGINX, re.M).group(1)

class WithPolicy(SinglePageApp):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Content-Security-Policy"] = CSP
        return response

app = Starlette(
    routes=[Mount("/api", app=api_app), Mount("/", app=WithPolicy(directory="web", html=True))],
    lifespan=lambda _: api_app.router.lifespan_context(api_app),
)
