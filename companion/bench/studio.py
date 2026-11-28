"""Studio's API for the measurements: the key from its file (never printed), the fleet's CA."""
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = os.environ["AI_URL"]
KEY = open(os.path.expanduser(os.environ["AI_KEY_FILE"])).read().strip()
CTX = ssl.create_default_context(cafile=os.path.expanduser(os.environ["AI_CA"]))


def raw(path, data=None, headers=None, timeout=900, method=None):
    h = {"Authorization": "Bearer " + KEY}
    h.update(headers or {})
    req = urllib.request.Request(BASE + path, data, h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def call(path, body=None, timeout=900, query=None):
    if query:
        path += "?" + urllib.parse.urlencode(query)
    code, data, _h = raw(path, json.dumps(body).encode() if body is not None else None,
                         {"Content-Type": "application/json"}, timeout)
    try:
        return code, json.loads(data or b"{}")
    except ValueError:
        return code, data.decode(errors="replace")[:800]


def multipart(path, fields, files, timeout=900):
    """fields: {name: value}; files: {name: (filename, bytes, type)}."""
    b = uuid.uuid4().hex
    out = []
    for k, v in fields.items():
        out.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (b, k, v)).encode())
    for k, (fn, data, ct) in files.items():
        out.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\nContent-Type: %s\r\n\r\n" % (b, k, fn, ct)).encode())
        out.append(data + b"\r\n")
    out.append(("--%s--\r\n" % b).encode())
    code, data, _h = raw(path, b"".join(out), {"Content-Type": "multipart/form-data; boundary=" + b}, timeout)
    try:
        return code, json.loads(data or b"{}")
    except ValueError:
        return code, data.decode(errors="replace")[:800]


def download(repo_id, variant, say=print, timeout=3600):
    """A GGUF variant into Studio's models folder; waits until it is there."""
    code, d = call("/api/hub/gguf-variants", query={"repo_id": repo_id})
    v = next((x for x in (d.get("variants") or []) if x["quant"] == variant), None) if isinstance(d, dict) else None
    if v is None:
        raise SystemExit("%s has no variant %s: %s" % (repo_id, variant, [x["quant"] for x in d.get("variants", [])] if isinstance(d, dict) else d))
    if v.get("downloaded"):
        return v
    code, d = call("/api/hub/download", {"repo_id": repo_id, "gguf_variant": variant})
    if code >= 300:
        raise SystemExit("download %s %s: %s %s" % (repo_id, variant, code, d))
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        time.sleep(3)
        code, d = call("/api/hub/gguf-variants", query={"repo_id": repo_id})
        v = next(x for x in d["variants"] if x["quant"] == variant)
        if v.get("downloaded"):
            say("downloaded %s %s (%.2f GB) in %.0f s" % (repo_id, variant, v["size_bytes"] / 1e9, time.monotonic() - t0))
            return v
    raise SystemExit("download of %s %s did not finish" % (repo_id, variant))
