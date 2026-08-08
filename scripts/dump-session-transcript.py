#!/usr/bin/env python3
# =============================================================================
# dump-session-transcript.py — Vuelca la transcripción de una sesión de
# opencode desde su base de datos local, INCLUIDOS los mensajes de los
# subagentes (issue #145).
#
# opencode run (--format default/json) no expone el contenido de los
# subagentes en el stream: solo muestra el inicio/fin de cada subagente.
# Sin embargo, opencode guarda TODOS los mensajes (sesión primaria y
# sesiones hijas enlazadas por parent_id) en su base de datos SQLite local
# (tablas session/message/part). Este script reconstruye el log completo:
#
#   - Sesión primaria: se busca por título exacto y momento de creación
#     (>= START_MS - 60000, la más reciente, parent_id IS NULL).
#   - Sesiones hijas: CTE recursiva sobre session.parent_id.
#   - Por cada mensaje assistant, en orden temporal: cabecera con hora,
#     agente y marca [subagente] si procede, y el texto de los parts
#     type=text completados (time.end). Los parts type=tool con
#     state.status=error imprimen el error del tool.
#
# Uso: dump-session-transcript.py <titulo-sesion> [start_epoch_ms]
# Best-effort: ante cualquier problema imprime un aviso en stderr y sale 0
# (nunca debe hacer fallar el workflow por un diagnóstico).
# =============================================================================
import json
import os
import sqlite3
import sys
import time


def find_db():
    """Localiza la base de datos local de opencode (best-effort)."""
    candidates = []
    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        candidates.append(os.path.join(xdg, "opencode", "opencode.db"))
    home = os.path.expanduser("~")
    candidates.extend(
        [
            os.path.join(home, ".local", "share", "opencode", "opencode.db"),
            os.path.join(home, ".opencode", "opencode.db"),
        ]
    )
    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def load_json(raw, default=None):
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return default


def fmt_time(epoch_ms):
    try:
        return time.strftime("%H:%M:%S", time.gmtime((epoch_ms or 0) / 1000))
    except (ValueError, TypeError, OverflowError):
        return "--:--:--"


def main():
    if len(sys.argv) < 2:
        print("uso: dump-session-transcript.py <titulo-sesion> [start_epoch_ms]", file=sys.stderr)
        return 0
    title = sys.argv[1]
    start_ms = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    db = find_db()
    if not db:
        print("(aviso: no se encontró la base de datos de opencode)", file=sys.stderr)
        return 0

    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    except sqlite3.Error as exc:
        print(f"(aviso: no se pudo abrir la base de datos de opencode: {exc})", file=sys.stderr)
        return 0
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Sesión primaria del run: título exacto y creada a partir del arranque
    # (margen de 60 s), la más reciente. parent_id IS NULL refuerza que sea
    # una sesión raíz (nunca un subagente).
    try:
        cur.execute(
            "SELECT id, agent, title FROM session "
            "WHERE title = ? AND parent_id IS NULL AND time_created >= ? "
            "ORDER BY time_created DESC LIMIT 1",
            (title, max(0, start_ms - 60000)),
        )
        primary = cur.fetchone()
    except sqlite3.Error as exc:
        print(f"(aviso: error al consultar la base de datos de opencode: {exc})", file=sys.stderr)
        conn.close()
        return 0

    if not primary:
        print(f"(aviso: no se encontró la sesión '{title}' en la base de datos de opencode)", file=sys.stderr)
        conn.close()
        return 0

    # Sesiones del run: primaria + descendientes (CTE recursiva por parent_id).
    try:
        cur.execute(
            "WITH RECURSIVE chain(id) AS ("
            "  SELECT ?"
            "  UNION ALL"
            "  SELECT s.id FROM session s JOIN chain c ON s.parent_id = c.id"
            ") SELECT id, parent_id, agent, title FROM session "
            "WHERE id IN (SELECT id FROM chain)",
            (primary["id"],),
        )
        sessions = {row["id"]: row for row in cur.fetchall()}
    except sqlite3.Error as exc:
        print(f"(aviso: error al consultar las sesiones hijas: {exc})", file=sys.stderr)
        conn.close()
        return 0

    subs = sorted(
        (s for s in sessions.values() if s["parent_id"]),
        key=lambda s: (s["parent_id"] or "", s["title"] or ""),
    )
    print(f"sesión primaria: {primary['id']} — agente '{primary['agent']}' — '{primary['title']}'")
    for s in subs:
        print(f"sesión subagente: {s['id']} — agente '{s['agent']}' — '{s['title']}'")
    print("----------------------------------------")

    # Mensajes assistant de todas las sesiones del run, en orden temporal.
    placeholders = ",".join("?" * len(sessions))
    try:
        cur.execute(
            f"SELECT id, session_id, time_created, data FROM message "
            f"WHERE session_id IN ({placeholders}) ORDER BY time_created, id",
            list(sessions.keys()),
        )
        messages = cur.fetchall()
    except sqlite3.Error as exc:
        print(f"(aviso: error al consultar los mensajes: {exc})", file=sys.stderr)
        conn.close()
        return 0

    printed_any = False
    for msg in messages:
        data = load_json(msg["data"])
        if not data or data.get("role") != "assistant":
            continue
        sid = msg["session_id"]
        sess = sessions.get(sid)
        is_sub = bool(sess is not None and sess["parent_id"])
        agent = data.get("agent") or (sess["agent"] if sess else "?")
        t = data.get("time") or {}
        when = fmt_time(t.get("created")) if isinstance(t, dict) else "--:--:--"
        marker = " [subagente]" if is_sub else ""
        print(f"--- {when} | {agent}{marker} ---")

        try:
            cur.execute(
                "SELECT data FROM part WHERE message_id = ? ORDER BY time_created, id",
                (msg["id"],),
            )
            parts = [row["data"] for row in cur.fetchall()]
        except sqlite3.Error:
            parts = []

        for raw_part in parts:
            part = load_json(raw_part)
            if not part:
                continue
            ptype = part.get("type")
            if ptype == "text" and (part.get("time") or {}).get("end"):
                text = (part.get("text") or "").strip()
                if text:
                    print(text)
                    printed_any = True
            elif ptype == "tool" and (part.get("state") or {}).get("status") == "error":
                err = part.get("state", {}).get("error")
                if err:
                    print(f"[tool {part.get('tool', '?')} falló] {err}")
                    printed_any = True

    if not printed_any:
        print("(sin mensajes de texto en esta sesión)")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
