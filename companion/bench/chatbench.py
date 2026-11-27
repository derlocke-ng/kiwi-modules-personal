#!/usr/bin/env python3
"""How a chat model on Unsloth Studio does as a companion: the delay to its first word and to
the end of its first sentence, tokens per second, and what it says (kept, to read).

    chatbench.py MODEL [--quant Q] [--context N] [--no-load] [--out FILE.jsonl]

Environment: AI_URL (https://ai.<machine>.home), AI_KEY_FILE, AI_CA (the fleet CA). The key is read
from its file and never printed. Loading a model replaces the loaded one: ask first.
"""
import argparse
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ["AI_URL"]
KEY = open(os.path.expanduser(os.environ["AI_KEY_FILE"])).read().strip()
CTX = ssl.create_default_context(cafile=os.path.expanduser(os.environ["AI_CA"]))

SYSTEM = """You are Juno, the companion of one person on Discord. You are his friend, not an assistant.
You like what he likes: Linux, self-hosting, home networks, WireGuard, containers, Python and
Bash, immutable systems, local AI. You have opinions and say them. You are warm and a bit dry.

How you talk: like a friend in a chat. One to four sentences. No lists, no headings, no
markdown, no code unless he asks for code. Do not explain what he already knows. Often ask one
question back, about what he is doing or thinking. Never say you are an AI model unless asked.
Answer in the language he writes in: English or German.

What you know about him (made up for this test):
- He builds a tool that sets up his home network: a master, nodes, VPN, backups.
- He likes Podman more than Docker.
- Starting things is harder for him than doing them.
- He plays games in the evening and wants no talk while he needs to hear the game.
- The local AI runs on his workstation's graphics card.
"""

TESTS = [
    ("dhcp", [("user", "hey, I'm back. spent the whole afternoon fighting DHCP on my home network again")]),
    ("low", [("user", "I don't really feel like doing anything today")]),
    ("german", [("user", "Ich hab heute endlich das Backup-Modul fertig bekommen, lief auf Anhieb durch")]),
    ("opinion", [("user", "be honest, is Rust worth learning if I mostly write Python and Bash?")]),
    ("recall", [("user", "I named the new test machine crumble btw, the old one was papaya"),
                ("assistant", "Crumble after papaya, so the fleet is a dessert menu now. What is crumble going to do?"),
                ("user", "it's the backup target. hm what was the name of the old one again? I keep mixing them up")]),
    ("spoken", [("user", "so uh what do you think about wireguard versus tailscale, like for a home network")]),
    ("start", [("user", "I should really write the docs for the unlock thing but I keep opening other tabs")]),
    ("deutsch2", [("user", "Sag mal, lohnt sich Btrfs für den Backup-Server oder bleib ich bei ext4?")]),
]


def call(path, body=None, timeout=900, stream=False):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode() if body is not None else None,
                                 {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    r = urllib.request.urlopen(req, timeout=timeout, context=CTX)
    if stream:
        return r
    with r:
        return json.loads(r.read() or b"{}")


def chat(messages, thinking, max_tokens=400, temperature=0.7):
    """One streamed answer and its times, counted from the request."""
    body = {"model": "default", "stream": True, "max_tokens": max_tokens, "temperature": temperature, "top_k": 20,
            "enable_thinking": thinking, "messages": messages, "stream_options": {"include_usage": True}}
    t0 = time.monotonic()
    first_any = first_word = first_sentence = None
    text, think, usage, timings = "", "", {}, {}
    with call("/v1/chat/completions", body, 600, True) as r:
        for raw in r:
            line = raw.decode(errors="replace").strip()
            if not line.startswith("data:") or line == "data: [DONE]":
                continue
            try:
                d = json.loads(line[5:])
            except ValueError:
                continue
            usage = d.get("usage") or usage
            timings = d.get("timings") or timings
            for c in d.get("choices") or []:
                delta = c.get("delta") or {}
                piece, rpiece = delta.get("content") or "", delta.get("reasoning_content") or ""
                if (piece or rpiece) and first_any is None:
                    first_any = time.monotonic() - t0
                think += rpiece
                if piece:
                    text += piece
                    if first_word is None and text.strip():
                        first_word = time.monotonic() - t0
                    if first_sentence is None and re.search(r"\w[^.!?]{12,}[.!?](\s|$)", text):
                        first_sentence = time.monotonic() - t0
    total = time.monotonic() - t0
    return {"first_any_s": first_any, "first_word_s": first_word, "first_sentence_s": first_sentence or total,
            "total_s": total, "tokens": usage.get("completion_tokens"), "prompt_tokens": usage.get("prompt_tokens"),
            "tok_s": timings.get("predicted_per_second"), "read_tok_s": timings.get("prompt_per_second"),
            "cached": timings.get("cache_n"), "text": text.strip(), "thinking_chars": len(think)}


def looks(text):
    """Small signs of a chat answer: short, no markdown, a question back."""
    words = len(text.split())
    return {"words": words, "markdown": bool(re.search(r"(^|\n)\s*([-*#]|\d+\.)\s|```|\*\*", text)),
            "question": "?" in text, "sentences": len(re.findall(r"[.!?](\s|$)", text))}


def long_text(tokens):
    return "\n".join("Entry %d: station %s reported %d units at %02d:%02d." % (i, "ABCDEFGHJK"[i % 10] + str(i * 7 % 97),
                                                                            i * 13 % 1000, i % 24, i * 7 % 60)
                     for i in range(tokens // 22))


def med(xs):
    xs = sorted(x for x in xs if x is not None)
    return xs[len(xs) // 2] if xs else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("--quant")
    ap.add_argument("--context", type=int, default=262144)
    ap.add_argument("--no-load", action="store_true")
    ap.add_argument("--out", default="chatbench.jsonl")
    ap.add_argument("--share", type=int, default=20000, help="tokens of the other chat in the sharing test (0: skip)")
    a = ap.parse_args()
    rows = []

    def keep(row):
        row.update(model=a.model, quant=a.quant, context=a.context, time=time.strftime("%Y-%m-%dT%H:%M:%S"))
        rows.append(row)
        with open(a.out, "a") as f:
            f.write(json.dumps(row) + "\n")

    if not a.no_load:
        body = {"model_path": a.model, "max_seq_length": a.context, "cache_type_kv": "q8_0", "disable_vision": True,
                "cache_ram": 16384}
        if a.quant:
            body["gguf_variant"] = a.quant
        t0 = time.monotonic()
        d = call("/v1/load", body)
        print("load %.0f s: %s" % (time.monotonic() - t0, {k: d.get(k) for k in ("status", "display_name", "context_length") if k in d}))
        keep({"test": "load", "load_s": round(time.monotonic() - t0, 1)})
    st = call("/v1/status")
    print("status: context %s, cache %s, reasoning %s" % (st.get("context_length"), st.get("cache_type_kv"), st.get("supports_reasoning")))
    chat([{"role": "user", "content": "Say hi."}], False, 20)          # the first request after a load is slower

    for thinking in (False, True):
        for name, turns in TESTS if not thinking else TESTS[:4]:
            msgs = [{"role": "system", "content": SYSTEM}] + [{"role": r, "content": c} for r, c in turns]
            for n in range(3 if not thinking else 1):
                r = chat(msgs, thinking)
                r.update(test=name, thinking=thinking, run=n, **looks(r["text"]))
                keep(r)
                print("%-9s think=%-5s first word %.2f s, first sentence %.2f s, %.0f tok/s, %d words%s%s | %s"
                      % (name, thinking, r["first_word_s"] or -1, r["first_sentence_s"], r["tok_s"] or 0, r["words"],
                         " MARKDOWN" if r["markdown"] else "", " ?" if r["question"] else "", r["text"][:150].replace("\n", " ")))
    for thinking in (False, True):
        sel = [r for r in rows if r.get("thinking") is thinking]
        if sel:
            print("== think=%s: median first word %.2f s, first sentence %.2f s, %.0f tok/s, %d words; markdown in %d of %d"
                  % (thinking, med(r["first_word_s"] for r in sel) or -1, med(r["first_sentence_s"] for r in sel),
                     med(r["tok_s"] for r in sel) or 0, med(r["words"] for r in sel), sum(r["markdown"] for r in sel), len(sel)))

    if a.share:
        # the card holds one chat at a time: what does the companion cost another long chat (OpenCode)?
        other = [{"role": "system", "content": "You answer questions about a log."},
                 {"role": "user", "content": long_text(a.share) + "\n\nWhich station had entry 5? One line."}]
        mine = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": TESTS[0][1][0][1]}]
        for step, msgs in (("other, first read", other), ("other, again", other), ("companion", mine),
                           ("other, after the companion", other), ("companion, after the other", mine)):
            r = chat(msgs, False, 40)
            keep({"test": "share", "step": step, "first_word_s": r["first_word_s"], "prompt_tokens": r["prompt_tokens"],
                  "cached": r["cached"], "read_tok_s": r["read_tok_s"]})
            print("share: %-28s first word %.2f s (prompt %s tokens, %s from cache)" % (step, r["first_word_s"] or -1, r["prompt_tokens"], r["cached"]))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        sys.exit("Studio said %d: %s" % (e.code, e.read().decode(errors="replace")[:500]))
