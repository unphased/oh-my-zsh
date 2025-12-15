#!/usr/bin/env python3

import argparse
import html
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class TestCaseResult:
    classname: str
    name: str
    time_s: float
    status: str
    failures: list[str]
    errors: list[str]
    system_out: str
    system_err: str

    @property
    def is_failed(self) -> bool:
        return bool(self.failures or self.errors)


def _text_of(el: ET.Element | None) -> str:
    if el is None:
        return ""
    text = "".join(el.itertext())
    return text.strip()


def _parse_time_s(value: str | None) -> float:
    if not value:
        return 0.0
    try:
        return float(value)
    except ValueError:
        return 0.0


def parse_junit(path: Path) -> tuple[dict[str, int | float], list[TestCaseResult]]:
    tree = ET.parse(path)
    root = tree.getroot()

    suites: list[ET.Element]
    if root.tag == "testsuite":
        suites = [root]
    else:
        suites = [el for el in root.findall("testsuite")]

    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0, "time_s": 0.0, "suites": len(suites)}

    cases: list[TestCaseResult] = []
    for suite in suites:
        totals["tests"] += int(suite.attrib.get("tests", "0"))
        totals["failures"] += int(suite.attrib.get("failures", "0"))
        totals["errors"] += int(suite.attrib.get("errors", "0"))
        totals["skipped"] += int(suite.attrib.get("skipped", "0"))
        totals["time_s"] += _parse_time_s(suite.attrib.get("time"))

        for tc in suite.findall("testcase"):
            failures = [_text_of(f) for f in tc.findall("failure") if _text_of(f)]
            errors = [_text_of(e) for e in tc.findall("error") if _text_of(e)]
            system_out = _text_of(tc.find("system-out"))
            system_err = _text_of(tc.find("system-err"))

            cases.append(
                TestCaseResult(
                    classname=tc.attrib.get("classname", ""),
                    name=tc.attrib.get("name", ""),
                    time_s=_parse_time_s(tc.attrib.get("time")),
                    status=tc.attrib.get("status", ""),
                    failures=failures,
                    errors=errors,
                    system_out=system_out,
                    system_err=system_err,
                )
            )

    return totals, cases


def render_text(path: Path, totals: dict[str, int | float], cases: list[TestCaseResult], top_n: int) -> str:
    failed = [c for c in cases if c.is_failed]
    slowest = sorted(cases, key=lambda c: c.time_s, reverse=True)[:top_n]

    lines: list[str] = []
    lines.append(f"JUnit: {path}")
    lines.append(
        "Suites: {suites}  Tests: {tests}  Failures: {failures}  Errors: {errors}  Skipped: {skipped}  Time: {time_s:.3f}s".format(
            **totals
        )
    )
    lines.append("")

    if failed:
        lines.append("Failures/errors:")
        for c in failed:
            lines.append(f"- {c.classname} :: {c.name} ({c.time_s:.3f}s)")
            for msg in c.failures:
                lines.append(f"  failure: {msg}")
            for msg in c.errors:
                lines.append(f"  error: {msg}")
            if c.system_err:
                lines.append("  system-err:")
                for ln in c.system_err.splitlines()[:20]:
                    lines.append(f"    {ln}")
            if c.system_out:
                lines.append("  system-out:")
                for ln in c.system_out.splitlines()[:20]:
                    lines.append(f"    {ln}")
        lines.append("")
    else:
        lines.append("Failures/errors: none")
        lines.append("")

    lines.append(f"Slowest {min(top_n, len(slowest))} tests:")
    for c in slowest:
        lines.append(f"- {c.time_s:.3f}s  {c.classname} :: {c.name}")

    return "\n".join(lines) + "\n"


def render_html(path: Path, totals: dict[str, int | float], cases: list[TestCaseResult], top_n: int) -> str:
    failed = [c for c in cases if c.is_failed]
    slowest = sorted(cases, key=lambda c: c.time_s, reverse=True)[:top_n]

    def esc(s: str) -> str:
        return html.escape(s, quote=True)

    def block(title: str, body: str) -> str:
        return f"<details><summary>{esc(title)}</summary><pre>{esc(body)}</pre></details>"

    rows_failed: list[str] = []
    for c in failed:
        details_parts: list[str] = []
        for msg in c.failures:
            details_parts.append(block("failure", msg))
        for msg in c.errors:
            details_parts.append(block("error", msg))
        if c.system_err:
            details_parts.append(block("system-err", c.system_err))
        if c.system_out:
            details_parts.append(block("system-out", c.system_out))

        rows_failed.append(
            "<tr class='fail'>"
            f"<td>{esc(c.classname)}</td>"
            f"<td>{esc(c.name)}</td>"
            f"<td class='num'>{c.time_s:.3f}</td>"
            f"<td>{''.join(details_parts) or ''}</td>"
            "</tr>"
        )

    rows_slowest: list[str] = []
    for c in slowest:
        rows_slowest.append(
            "<tr>"
            f"<td>{esc(c.classname)}</td>"
            f"<td>{esc(c.name)}</td>"
            f"<td class='num'>{c.time_s:.3f}</td>"
            "</tr>"
        )

    summary = (
        f"Suites: {totals['suites']} · Tests: {totals['tests']} · Failures: {totals['failures']} · "
        f"Errors: {totals['errors']} · Skipped: {totals['skipped']} · Time: {totals['time_s']:.3f}s"
    )

    return f"""<!doctype html>
<meta charset="utf-8" />
<title>JUnit Report</title>
<style>
  :root {{
    color-scheme: light dark;
    --fg: #111;
    --bg: #fff;
    --muted: #666;
    --fail: #b00020;
    --border: rgba(127,127,127,.35);
  }}
  body {{ font: 14px/1.35 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 20px; }}
  h1 {{ margin: 0 0 6px; font-size: 18px; }}
  .muted {{ color: var(--muted); }}
  table {{ border-collapse: collapse; width: 100%; }}
  th, td {{ border: 1px solid var(--border); padding: 6px 8px; vertical-align: top; }}
  th {{ text-align: left; position: sticky; top: 0; backdrop-filter: blur(4px); }}
  td.num {{ text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }}
  tr.fail td {{ border-left: 3px solid var(--fail); }}
  details > summary {{ cursor: pointer; user-select: none; }}
  pre {{ white-space: pre-wrap; word-break: break-word; margin: 6px 0 0; }}
</style>
<h1>JUnit Report</h1>
<div class="muted">{esc(str(path))}</div>
<div class="muted">{esc(summary)}</div>

<h2>Failures / Errors ({len(failed)})</h2>
<table>
  <thead><tr><th>Class</th><th>Name</th><th class="num">Time (s)</th><th>Details</th></tr></thead>
  <tbody>
    {''.join(rows_failed) if rows_failed else '<tr><td colspan=\"4\" class=\"muted\">none</td></tr>'}
  </tbody>
</table>

<h2>Slowest Tests (top {min(top_n, len(slowest))})</h2>
<table>
  <thead><tr><th>Class</th><th>Name</th><th class="num">Time (s)</th></tr></thead>
  <tbody>
    {''.join(rows_slowest) if rows_slowest else '<tr><td colspan=\"3\" class=\"muted\">none</td></tr>'}
  </tbody>
</table>
"""


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Summarize a JUnit XML report (Catch2-friendly).")
    parser.add_argument("junit_xml", nargs="?", default="debug/junit.xml", help="Path to JUnit XML (default: debug/junit.xml)")
    parser.add_argument("--top", type=int, default=15, help="Number of slowest tests to show")
    parser.add_argument("--html", dest="html_out", default=None, help="Write a simple HTML report to this path")
    args = parser.parse_args(argv)

    path = Path(args.junit_xml)
    if not path.exists():
        print(f"error: JUnit XML not found: {path}", file=sys.stderr)
        return 2

    totals, cases = parse_junit(path)

    if args.html_out:
        out_path = Path(args.html_out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(render_html(path, totals, cases, args.top), encoding="utf-8")
        print(f"Wrote: {out_path}")
        return 0

    sys.stdout.write(render_text(path, totals, cases, args.top))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

