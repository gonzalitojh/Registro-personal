#!/usr/bin/env python3
# =============================================================================
# dump-session-transcript.py — Vuelca/transmite la transcripción de una sesión
# de opencode desde su base de datos local, INCLUIDOS los mensajes de los
# subagentes (issue #145, iteración 2).
#
# opencode run (--format default/json) no expone el contenido de los
# subagentes en el stream: solo muestra el inicio/fin de cada subagente.
# Sin embargo, opencode guarda TODOS los mensajes (sesión primaria y
# sesiones hijas enlazadas por parent_id) en su base de datos SQLite local
# (tablas session/message/part). Este script ofrece tres modos:
#
#   - MODO DUMP (por defecto): reconstruye el log completo de la sesión
#     después de que termine (éxito o fallo):
#       * Sesión primaria: se busca por título exacto y momento de creación
#         (>= START_MS - 60000, la más reciente, parent_id IS NULL).
#       * Sesiones hijas: CTE recursiva sobre session.parent_id.
#       * Por cada mensaje assistant, en orden temporal: cabecera con hora,
#         agente y marca [subagente] si procede, y el texto de los parts
#         type=text completados (time.end). Los parts type=tool con
#         state.status=error imprimen el error del tool.
#
#   - MODO --watch [poll_sec]: STREAMING EN VIVO de los subagentes. Hace
#     polling de la BD cada poll_sec (default 5) e imprime en stdout los
#     mensajes assistant COMPLETADOS de las sesiones hijas (nunca de la
#     primaria: su output ya sale en el stream de opencode) a medida que
#     aparecen, con el mismo formato que el modo dump. Se lanza en
#     background desde run-sdd-session.sh y termina limpio con SIGTERM.
#
#   - MODO --activity: sonda para el watchdog. Imprime el epoch_ms del
#     último activity (MAX(time_updated) sobre message y part de TODAS las
#     sesiones del árbol, primaria + hijas) o "0" si la sesión primaria
#     aún no existe en la BD. Exit 0 siempre que la consulta sea válida;
#     exit 1 si la BD no está disponible o falla la consulta (el shell
#     distingue: "0" ≠ fallo).
#
# Uso:
#   dump-session-transcript.py <titulo-sesion> [start_epoch_ms]
#   dump-session-transcript.py --watch <titulo-sesion> [start_epoch_ms] [poll_sec]
#   dump-session-transcript.py --activity <titulo-sesion> [start_epoch_ms]
#
# Best-effort: ante cualquier problema imprime un aviso en stderr y sale 0
# (nunca debe hacer fallar el workflow por un diagnóstico). EXCEPCIÓN: el
# modo --activity devuelve exit 1 en fallo real de BD/consulta para que el
# watchdog pueda detectar la degradación.
# =============================================================================
import json
import os
import signal
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


def open_db():
    """Abre la BD en modo read-only; devuelve conexión o None."""
    db = find_db()
    if not db:
        return None
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error:
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


def find_primary(conn, title, start_ms):
    """Sesión raíz del run: título exacto, creada tras el arranque (margen
    60 s), la más reciente y con parent_id IS NULL (nunca un subagente)."""
    cur = conn.cursor()
    cur.execute(
        "SELECT id, agent, title FROM session "
        "WHERE title = ? AND parent_id IS NULL AND time_created >= ? "
        "ORDER BY time_created DESC LIMIT 1",
        (title, max(0, start_ms - 60000)),
    )
    return cur.fetchone()


def session_tree(conn, primary_id):
    """Dict {id: row} con la sesión primaria y TODOS sus descendientes
    (CTE recursiva por parent_id)."""
    cur = conn.cursor()
    cur.execute(
        "WITH RECURSIVE chain(id) AS ("
        "  SELECT ?"
        "  UNION ALL"
        "  SELECT s.id FROM session s JOIN chain c ON s.parent_id = c.id"
        ") SELECT id, parent_id, agent, title FROM session "
        "WHERE id IN (SELECT id FROM chain)",
        (primary_id,),
    )
    return {row["id"]: row for row in cur.fetchall()}


def message_parts(conn, message_id):
    """Parts de un mensaje (listas de dicts ya parseadas)."""
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT data FROM part WHERE message_id = ? ORDER BY time_created, id",
            (message_id,),
        )
        return [p for p in (load_json(r["data"]) for r in cur.fetchall()) if p]
    except sqlite3.Error:
        return []


def message_completed(parts):
    """Un mensaje está 'completado' cuando todos sus parts con time tienen
    time.end y hay al menos uno. Sirve para el modo --watch: no se imprime
    texto a medio generar."""
    timed = [p for p in parts if p.get("time")]
    if not timed:
        return False
    return all(p["time"].get("end") for p in timed)


def print_message(conn, msg, sess):
    """Imprime la cabecera y el contenido de un mensaje assistant.
    Devuelve True si imprimió algo."""
    data = load_json(msg["data"])
    if not data or data.get("role") != "assistant":
        return False
    is_sub = bool(sess is not None and sess["parent_id"])
    agent = data.get("agent") or (sess["agent"] if sess else "?")
    t = data.get("time") or {}
    when = fmt_time(t.get("created")) if isinstance(t, dict) else "--:--:--"
    marker = " [subagente]" if is_sub else ""
    print(f"--- {when} | {agent}{marker} ---")

    printed_any = False
    for part in message_parts(conn, msg["id"]):
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
    return printed_any


# ---------------------------------------------------------------------------
# MODO DUMP — transcripción completa (éxito o fallo)
# ---------------------------------------------------------------------------
def cmd_dump(title, start_ms):
    conn = open_db()
    if conn is None:
        print("(aviso: no se encontró la base de datos de opencode)", file=sys.stderr)
        return 0

    try:
        primary = find_primary(conn, title, start_ms)
    except sqlite3.Error as exc:
        print(f"(aviso: error al consultar la base de datos de opencode: {exc})", file=sys.stderr)
        conn.close()
        return 0

    if not primary:
        print(f"(aviso: no se encontró la sesión '{title}' en la base de datos de opencode)", file=sys.stderr)
        conn.close()
        return 0

    try:
        sessions = session_tree(conn, primary["id"])
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

    placeholders = ",".join("?" * len(sessions))
    try:
        cur = conn.cursor()
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
        if print_message(conn, msg, sessions.get(msg["session_id"])):
            printed_any = True

    if not printed_any:
        print("(sin mensajes de texto en esta sesión)")
    conn.close()
    return 0


# ---------------------------------------------------------------------------
# MODO --watch — streaming en vivo de los subagentes
# ---------------------------------------------------------------------------
def cmd_watch(title, start_ms, poll_sec):
    def _term(_signum, _frame):
        sys.exit(0)

    signal.signal(signal.SIGTERM, _term)

    printed_ids = set()
    grace_until = time.time() + 60  # margen para que la sesión aparezca en BD

    while True:
        conn = open_db()
        if conn is None:
            time.sleep(poll_sec)
            continue

        try:
            primary = find_primary(conn, title, start_ms)
            if primary is None:
                if time.time() > grace_until:
                    print("(aviso: no se encontró la sesión primaria en --watch; terminando)", file=sys.stderr)
                    conn.close()
                    return 0
                conn.close()
                time.sleep(poll_sec)
                continue

            sessions = session_tree(conn, primary["id"])
            subs = {k: v for k, v in sessions.items() if v["parent_id"]}
            if not subs:
                conn.close()
                time.sleep(poll_sec)
                continue

            placeholders = ",".join("?" * len(subs))
            cur = conn.cursor()
            cur.execute(
                f"SELECT id, session_id, time_created, data FROM message "
                f"WHERE session_id IN ({placeholders}) ORDER BY time_created, id",
                list(subs.keys()),
            )
            for msg in cur.fetchall():
                if msg["id"] in printed_ids:
                    continue
                data = load_json(msg["data"])
                if not data or data.get("role") != "assistant":
                    continue
                parts = message_parts(conn, msg["id"])
                if not message_completed(parts):
                    continue  # aún en curso; se reintenta en el próximo ciclo
                if print_message(conn, msg, subs.get(msg["session_id"])):
                    sys.stdout.flush()
                printed_ids.add(msg["id"])
        except sqlite3.Error as exc:
            print(f"(aviso: error en --watch al consultar la BD: {exc})", file=sys.stderr)
        finally:
            conn.close()

        time.sleep(poll_sec)


# ---------------------------------------------------------------------------
# MODO --activity — sonda de actividad para el watchdog
# ---------------------------------------------------------------------------
def cmd_activity(title, start_ms):
    conn = open_db()
    if conn is None:
        print("(aviso: no se encontró la base de datos de opencode)", file=sys.stderr)
        return 1

    try:
        primary = find_primary(conn, title, start_ms)
        if primary is None:
            print("0")  # la sesión aún no existe en BD: sin actividad (válido)
            conn.close()
            return 0
        sessions = session_tree(conn, primary["id"])
        placeholders = ",".join("?" * len(sessions))
        ids = list(sessions.keys())
        cur = conn.cursor()
        cur.execute(
            f"SELECT MAX(ts) AS m FROM ("
            f"  SELECT MAX(time_updated) AS ts FROM message WHERE session_id IN ({placeholders})"
            f"  UNION ALL"
            f"  SELECT MAX(time_updated) AS ts FROM part WHERE session_id IN ({placeholders})"
            f")",
            ids + ids,
        )
        row = cur.fetchone()
        print(row["m"] or 0)
        conn.close()
        return 0
    except sqlite3.Error as exc:
        print(f"(aviso: error en --activity al consultar la BD: {exc})", file=sys.stderr)
        try:
            conn.close()
        except sqlite3.Error:
            pass
        return 1


def main():
    args = sys.argv[1:]
    if not args:
        print("uso: dump-session-transcript.py <titulo> [start_ms] | --watch <titulo> [start_ms] [poll] | --activity <titulo> [start_ms]", file=sys.stderr)
        return 0

    mode = args[0]
    if mode == "--watch":
        title = args[1] if len(args) > 1 else ""
        start_ms = int(args[2]) if len(args) > 2 else 0
        poll_sec = int(args[3]) if len(args) > 3 else int(os.environ.get("SESSION_WATCH_POLL_SEC", "5"))
        if not title:
            print("uso: dump-session-transcript.py --watch <titulo> [start_ms] [poll]", file=sys.stderr)
            return 0
        return cmd_watch(title, start_ms, poll_sec)
    if mode == "--activity":
        title = args[1] if len(args) > 1 else ""
        start_ms = int(args[2]) if len(args) > 2 else 0
        if not title:
            print("uso: dump-session-transcript.py --activity <titulo> [start_ms]", file=sys.stderr)
            return 1
        return cmd_activity(title, start_ms)

    # Modo dump por defecto (compatibilidad con la iteración 1).
    title = args[0]
    start_ms = int(args[1]) if len(args) > 1 else 0
    return cmd_dump(title, start_ms)


if __name__ == "__main__":
    sys.exit(main())
