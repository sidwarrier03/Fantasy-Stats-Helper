"""Tiny HTTP helper (standard library only)."""
import gzip
import json
import time
import urllib.error
import urllib.request

UA = "Huddle/1.0 (personal fantasy football database)"


def get_json(url, timeout=60, retries=3):
    """GET a URL and decode JSON. Returns None on 404. Retries transient errors."""
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                if not data:
                    return None
                return json.loads(data.decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = e
        except Exception as e:  # network blips, timeouts, bad JSON
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed: {last}")
