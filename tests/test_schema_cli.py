import codecs
import copy
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from fieldservice.brand import PRODUCT_NAME
from fieldservice.cli import main
from fieldservice.example import TODAY, build_example
from fieldservice.schema import export_backup, import_backup, parse_json, validate_book
from fieldservice.util import ServiceError

ROOT = Path(__file__).resolve().parent.parent
EX = build_example()


def test_backup_round_trip():
    text = json.dumps(export_backup(EX, "2026-10-22T00:00:00Z"))
    assert import_backup(parse_json(text)) == EX


@pytest.mark.parametrize("mutate,msg", [
    (lambda b: b["clients"][0].update(name=""), "is required"),
    (lambda b: b["clients"][0].update(evil=1), "unknown field"),
    (lambda b: b["clients"][0].update(name="x" * 201), "at most 200"),
    (lambda b: b["invoices"][0]["lines"][0].update(rate=1.5), "whole number of cents"),
    (lambda b: b["invoices"][0]["lines"][0].update(rate=True), "whole number of cents"),
    (lambda b: b["invoices"][0].update(date="2026-02-30"), "real calendar date"),
    (lambda b: b["visits"][0].update(start_time="25:00"), "not a time of day"),
    (lambda b: b["visits"][0].update(job_id="ghost"), "there is no job"),
    (lambda b: b["payments"][0].update(amount=-5), "from 1 to"),
    (lambda b: b["clients"].append(dict(b["clients"][0])), "already used"),
    (lambda b: b["properties"][0].update(lat_e6=91_000_000), "millionths"),
    (lambda b: b["jobs"][0].update(rule={"freq": "weekly", "days": []}), "at least one day"),
    (lambda b: b["visits"][0].update(started_at="2026-10-05T08:00:00", status="completed"), "time stamp"),
    (lambda b: b["log"][-1]["changes"].append({"kind": "x", "id": "1", "before": None, "after": None}), "kind"),
    (lambda b: b.update(extra=1), "unknown field"),
    (lambda b: b["settings"].update(payment_links=[{"kind": "bitcoin", "value": "x"}]), "must be one of"),
])
def test_hostile_backups_are_refused(mutate, msg):
    b = copy.deepcopy(EX)
    mutate(b)
    with pytest.raises(ServiceError, match=msg):
        import_backup(export_backup(b, "2026-10-22T00:00:00Z"))


def test_backup_envelope():
    with pytest.raises(ServiceError, match="not a backup"):
        import_backup({"format": "x"})
    with pytest.raises(ServiceError, match="newer version"):
        import_backup({"format": "field-tools-17-service", "version": 9, "book": EX})
    with pytest.raises(ServiceError, match="not valid JSON"):
        parse_json('{"a": NaN}')
    with pytest.raises(ServiceError, match="not valid JSON"):
        parse_json("{" * 100000)
    with pytest.raises(ServiceError):
        parse_json("[1,")


def test_example_is_labeled_and_valid():
    assert EX["example"] is True
    assert EX["name"].startswith("Example:") and EX["settings"]["business_name"].startswith("Example:")
    validate_book(EX)
    for c in EX["clients"]:
        assert c["email"] == "" or c["email"].endswith("@example.com")
        assert c["phone"] == "" or "555) 010-" in c["phone"]


def test_cli(tmp_path, capsys):
    out = tmp_path / "ex.json"
    assert main(["example", "--out", str(out)]) == 0
    assert main(["verify", str(out)]) == 0
    assert "10 clients" in capsys.readouterr().out
    assert main(["report", "aging", "--backup", str(out), "--csv"]) == 0
    assert capsys.readouterr().out.startswith("client_id,name,current")
    assert main(["crossfoot", "--backup", str(out), "--from", "2026-07-01", "--to", TODAY]) == 0
    assert capsys.readouterr().out.startswith("!ACCNT")
    assert main(["page", "invoices", EX["invoices"][0]["id"], "--backup", str(out)]) == 0
    assert "<!doctype html>" in capsys.readouterr().out
    assert main(["packet", "m-dana", "--backup", str(out), "--from", TODAY, "--to", "2026-10-28",
                 "--at", "2026-10-22T06:00:00-05:00"]) == 0
    assert json.loads(capsys.readouterr().out)["kind"] == "out"
    assert main(["automate", "--backup", str(out), "--today", "2026-10-23", "--at", "2026-10-23T06:00:00-05:00"]) == 0
    assert main(["schedule", "--backup", str(out), "--from", "2026-10-26", "--to", "2026-10-26", "--crew",
                 "m-dana"]) == 0
    assert "saved_m" in capsys.readouterr().out
    bad = tmp_path / "bad.json"
    bad.write_text("{nope")
    assert main(["verify", str(bad)]) == 2
    assert main(["verify", str(tmp_path / "missing.json")]) == 2


# ---------------------------------------------------------------- repository rules

def repo_files():
    try:
        out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT, capture_output=True,
                             text=True, check=True).stdout.split("\n")
        files = [ROOT / p for p in out if p]
    except (OSError, subprocess.CalledProcessError):
        files = [p for p in ROOT.rglob("*") if ".git" not in p.parts]
    for p in files:
        if p.is_file() and "__pycache__" not in p.parts and "egg-info" not in str(p) and ".pytest_cache" not in p.parts:
            yield p


# Words that must never appear in the repository, stored rot13 so this file passes its own check.
BANNED = [codecs.decode(w, "rot13") for w in ("pynhqr", "naguebcvp", "pungtcg", "bcranv", "pbcvybg", "fnaqobk",
                                                "ntrag", "oevrs", "fcrp")]
NOTES = [codecs.decode(w, "rot13") + ".md" for w in ("PYNHQR", "NTRAGF")]
# The one allowed use of a banned word: the HTML isolation attribute on the client copy preview frame.
ALLOWED = ['frame.setAttribute("' + codecs.decode("fnaqobk", "rot13") + '", "")']


def test_repository_rules():
    banned = re.compile(r"\b(" + "|".join(BANNED) + r")s?\b|\bAI[- ](generated|" + codecs.decode("nffvfg", "rot13")
                        + r"\w*)\b|" + chr(0x2014), re.I)
    for p in repo_files():
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for a in ALLOWED:
            text = text.replace(a, "")
        assert banned.search(text) is None, f"{p}: banned text"
        assert ("/ho" + "me/") not in text, str(p)
    for name in NOTES:
        assert not list(ROOT.rglob(name))


def test_commit_messages_follow_the_rules():
    try:
        msgs = subprocess.run(["git", "log", "--format=%an <%ae>%n%B%n----"], cwd=ROOT, capture_output=True, text=True,
                              check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("not a git checkout")
    banned = re.compile(r"\b(" + "|".join(BANNED) + r")s?\b|" + chr(0x2014), re.I)
    assert banned.search(msgs) is None
    assert re.search(r"^[A-Za-z-]+-by: ", msgs, re.M) is None


def test_product_name_lives_in_one_place():
    allowed = {"brand.py", "00_brand.js", "README.md", "test_schema_cli.py", "vectors.json", "90_example_data.js"}
    for p in repo_files():
        rel = p.relative_to(ROOT).as_posix()
        if not (rel.startswith("src/") or rel.startswith("web/src/core/") or rel.startswith("tests/")):
            continue
        if p.suffix in (".py", ".js", ".mjs", ".html", ".json") and p.name not in allowed:
            assert PRODUCT_NAME not in p.read_text(encoding="utf-8", errors="ignore"), str(p)


def test_vectors_are_current():
    vec = ROOT / "tests" / "vectors.json"
    if not vec.exists():
        pytest.skip("vectors not generated yet")
    r = subprocess.run([sys.executable, str(ROOT / "tests" / "make_vectors.py"), "--check"], capture_output=True,
                       text=True)
    assert r.returncode == 0, r.stdout + r.stderr
