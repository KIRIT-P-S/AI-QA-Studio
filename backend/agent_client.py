import os
import secrets
import time
import subprocess
import requests
import json
from typing import Dict, Any

from store import DATA_DIR
TOKEN_FILE = os.path.join(DATA_DIR, ".agent-token")
AGENT_URL = "http://127.0.0.1:4318"

def agent_token() -> str:
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        token = secrets.token_hex(32)
        try:
            # We try to create exclusively
            with open(TOKEN_FILE, "x", encoding="utf-8") as f:
                f.write(token)
            os.chmod(TOKEN_FILE, 0o600)
            return token
        except FileExistsError:
            with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                return f.read().strip()

def agent_call(command: str, payload: Dict[str, Any] = None, start: bool = False) -> Dict[str, Any]:
    if payload is None:
        payload = {}

    token = agent_token()
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }

    timeout = 1 if command == "status" else 45 if command == "connect" else 15

    def make_request():
        resp = requests.post(
            f"{AGENT_URL}/{command}",
            json=payload,
            headers=headers,
            timeout=timeout
        )
        return resp

    try:
        response = make_request()
    except requests.exceptions.RequestException:
        if command == "status":
            return {"online": False, "connected": False, "mode": "Manual", "state": "Disconnected",
                    "message": "Connect the application to start the browser agent.", "logs": []}
        if not start:
            raise Exception("Browser agent is offline. Connect the application to start it.")

        agent_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "agent"))
        log_file = os.path.join(DATA_DIR, "agent.log")

        # Start the TS agent subprocess
        env = os.environ.copy()
        env["STUDIO_DATA_DIR"] = DATA_DIR

        tsx_cli = os.path.join(agent_dir, "node_modules", "tsx", "dist", "cli.mjs")
        server_ts = os.path.join(agent_dir, "src", "server.ts")

        with open(log_file, "a") as log_fd:
            subprocess.Popen(
                ["node", tsx_cli, server_ts],
                cwd=agent_dir,
                stdout=log_fd,
                stderr=log_fd,
                env=env,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            )

        online = False
        for _ in range(30):
            time.sleep(0.3)
            try:
                health = requests.get(
                    f"{AGENT_URL}/health",
                    headers=headers,
                    timeout=0.5
                )
                if health.status_code == 200:
                    online = True
                    break
            except requests.exceptions.RequestException:
                pass

        if not online:
            raise Exception("Could not start the local browser agent. Check data/studio/agent.log and install agent dependencies.")

        response = make_request()

    try:
        result = response.json()
    except json.JSONDecodeError:
        raise Exception("Agent did not return valid JSON.")

    if not response.ok:
        raise Exception(result.get("error", "Browser agent request failed."))

    return result
