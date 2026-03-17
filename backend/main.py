from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import asyncio
import json
import math
import time
from datetime import datetime
from typing import Optional
import asyncpg
from shapely.geometry import Point, Polygon

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Database connection ───────────────────────────────────────
DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "database": "gps_tracker",
    "user": "postgres",
    "password": "dhinesh17"
}

async def get_db():
    return await asyncpg.connect(**DB_CONFIG)

# ─── Create tables on startup ──────────────────────────────────
@app.on_event("startup")
async def startup():
    try:
        conn = await get_db()
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS gps_trail (
                id SERIAL PRIMARY KEY,
                device_id TEXT,
                lat DOUBLE PRECISION,
                lon DOUBLE PRECISION,
                speed DOUBLE PRECISION,
                acceleration DOUBLE PRECISION,
                jerk DOUBLE PRECISION,
                behaviour TEXT,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS alerts (
                id SERIAL PRIMARY KEY,
                device_id TEXT,
                type TEXT,
                message TEXT,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS geofence_zones (
                id SERIAL PRIMARY KEY,
                name TEXT,
                coordinates TEXT
            );
            CREATE TABLE IF NOT EXISTS stop_reasons (
                id SERIAL PRIMARY KEY,
                device_id TEXT,
                reason TEXT,
                lat DOUBLE PRECISION,
                lon DOUBLE PRECISION,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );
        """)
        await conn.close()
        print("✅ Database tables ready")
    except Exception as e:
        print(f"⚠️ DB connection failed: {e} — running without DB")

    asyncio.create_task(start_tcp_server())

# ─── In-memory state per device ───────────────────────────────
device_state = {}

# ─── Helper: Haversine distance (meters) ──────────────────────
def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

# ─── Helper: Behaviour classification ─────────────────────────
def classify_behaviour(speed_kmh):
    if speed_kmh < 0.5:
        return "stopped"
    elif speed_kmh < 20:
        return "slow"
    elif speed_kmh <= 60:
        return "normal"
    else:
        return "overspeed"

# ─── Helper: Analytics calculation ────────────────────────────
def calculate_analytics(device_id, lat, lon, timestamp):
    state = device_state.get(device_id)
    speed = 0.0
    acceleration = 0.0
    jerk = 0.0

    if state:
        dt = timestamp - state["timestamp"]
        if dt > 0:
            distance = haversine(state["lat"], state["lon"], lat, lon)
            speed = (distance / dt) * 3.6
            speed_ms = distance / dt
            prev_speed_ms = state["speed"] / 3.6
            acceleration = (speed_ms - prev_speed_ms) / dt
            prev_accel = state.get("acceleration", 0)
            jerk = (acceleration - prev_accel) / dt

    device_state[device_id] = {
        "lat": lat, "lon": lon,
        "timestamp": timestamp,
        "speed": speed,
        "acceleration": acceleration,
        "stopped_since": device_state.get(device_id, {}).get("stopped_since") if speed < 0.5 else None
    }

    if speed < 0.5 and not device_state[device_id]["stopped_since"]:
        device_state[device_id]["stopped_since"] = timestamp

    return speed, acceleration, jerk

# ─── Geofence checker (restricted zone — alert on ENTRY) ──────
async def check_geofence(device_id, lat, lon):
    try:
        conn = await get_db()
        zones = await conn.fetch(
            "SELECT id, name, coordinates FROM geofence_zones"
        )
        await conn.close()

        point = Point(lon, lat)

        if device_id not in device_state:
            device_state[device_id] = {}

        for zone in zones:
            coords = json.loads(zone["coordinates"])
            polygon = Polygon([(p[1], p[0]) for p in coords])
            currently_inside = polygon.contains(point)

            zone_key = f"inside_zone_{zone['id']}"
            was_inside = device_state[device_id].get(zone_key, False)

            # Always update state first
            device_state[device_id][zone_key] = currently_inside

            # Just entered
            if not was_inside and currently_inside:
                print(f"🚨 {device_id} ENTERED restricted zone: {zone['name']}")
                try:
                    conn = await get_db()
                    await conn.execute("""
                        INSERT INTO alerts (device_id, type, message)
                        VALUES ($1, $2, $3)
                    """, device_id, "zone_violation",
                        f"Entered restricted zone '{zone['name']}' at {lat:.4f},{lon:.4f}")
                    await conn.close()
                except Exception as e:
                    print(f"Alert save error: {e}")
                return {
                    "geofence_alert": True,
                    "zone_name": zone["name"],
                    "message": f"Entered restricted zone '{zone['name']}'"
                }

            # Still inside
            if was_inside and currently_inside:
                return {
                    "geofence_alert": True,
                    "zone_name": zone["name"],
                    "message": f"Inside restricted zone '{zone['name']}'"
                }

            # Just left
            if was_inside and not currently_inside:
                print(f"✅ {device_id} LEFT restricted zone: {zone['name']}")
                return {
                    "geofence_alert": False,
                    "zone_name": None,
                    "message": None
                }

    except Exception as e:
        print(f"Geofence check error: {e}")

    return {
        "geofence_alert": False,
        "zone_name": None,
        "message": None
    }

# ─── WebSocket manager ────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, data: dict):
        for ws in self.active:
            try:
                await ws.send_json(data)
            except:
                pass

manager = ConnectionManager()

# ─── WebSocket endpoint ───────────────────────────────────────
@app.websocket("/ws/{device_id}")
async def websocket_endpoint(websocket: WebSocket, device_id: str):
    await manager.connect(websocket)
    print(f"📡 Device connected: {device_id}")
    try:
        while True:
            data = await websocket.receive_text()
            gps = json.loads(data)

            lat = gps["lat"]
            lon = gps["lon"]
            timestamp = time.time()

            speed, acceleration, jerk = calculate_analytics(device_id, lat, lon, timestamp)
            behaviour = classify_behaviour(speed)
            crash = abs(jerk) > 8 and abs(acceleration) > 4
            geofence_result = await check_geofence(device_id, lat, lon)

            state = device_state.get(device_id, {})
            stopped_duration = 0
            ask_stop_reason = False
            if state.get("stopped_since"):
                stopped_duration = timestamp - state["stopped_since"]
                if stopped_duration > 30:
                    ask_stop_reason = True

            payload = {
                "device_id": device_id,
                "lat": lat,
                "lon": lon,
                "speed": round(speed, 2),
                "acceleration": round(acceleration, 4),
                "jerk": round(jerk, 4),
                "behaviour": behaviour,
                "crash_detected": crash,
                "ask_stop_reason": ask_stop_reason,
                "stopped_duration": round(stopped_duration, 1),
                "timestamp": datetime.now().isoformat(),
                "geofence_alert": geofence_result["geofence_alert"],
                "geofence_zone": geofence_result["zone_name"],
                "geofence_message": geofence_result["message"]
            }

            try:
                conn = await get_db()
                await conn.execute("""
                    INSERT INTO gps_trail (device_id, lat, lon, speed, acceleration, jerk, behaviour)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                """, device_id, lat, lon, speed, acceleration, jerk, behaviour)
                if crash:
                    await conn.execute("""
                        INSERT INTO alerts (device_id, type, message)
                        VALUES ($1, $2, $3)
                    """, device_id, "crash", f"Crash detected at {lat},{lon}")
                await conn.close()
            except Exception as e:
                print(f"DB write skipped: {e}")

            await manager.broadcast(payload)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        print(f"❌ Device disconnected: {device_id}")

# ─── REST: Get full trail ─────────────────────────────────────
@app.get("/trail/{device_id}")
async def get_trail(device_id: str):
    try:
        conn = await get_db()
        rows = await conn.fetch("""
            SELECT lat, lon, speed, behaviour, timestamp
            FROM gps_trail WHERE device_id = $1
            ORDER BY timestamp ASC
        """, device_id)
        await conn.close()
        return [dict(r) for r in rows]
    except:
        return []

# ─── REST: Clear trail ────────────────────────────────────────
@app.delete("/trail/{device_id}")
async def clear_trail(device_id: str):
    try:
        conn = await get_db()
        await conn.execute(
            "DELETE FROM gps_trail WHERE device_id = $1", device_id
        )
        await conn.close()
        return {"status": "trail cleared"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

# ─── REST: Save stop reason ───────────────────────────────────
@app.post("/stop-reason")
async def save_stop_reason(data: dict):
    try:
        conn = await get_db()
        await conn.execute("""
            INSERT INTO stop_reasons (device_id, reason, lat, lon)
            VALUES ($1, $2, $3, $4)
        """, data["device_id"], data["reason"], data["lat"], data["lon"])
        await conn.close()
        return {"status": "saved"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

# ─── REST: Save geofence zone ─────────────────────────────────
@app.post("/geofence")
async def save_geofence(data: dict):
    try:
        conn = await get_db()
        await conn.execute("""
            INSERT INTO geofence_zones (name, coordinates)
            VALUES ($1, $2)
        """, data["name"], json.dumps(data["coordinates"]))
        await conn.close()
        return {"status": "saved"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

# ─── REST: Get all geofence zones ─────────────────────────────
@app.get("/geofence")
async def get_geofences():
    try:
        conn = await get_db()
        rows = await conn.fetch(
            "SELECT id, name, coordinates FROM geofence_zones"
        )
        await conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        return []

# ─── REST: Delete geofence zone ───────────────────────────────
@app.delete("/geofence/{zone_id}")
async def delete_geofence(zone_id: int):
    try:
        conn = await get_db()
        await conn.execute(
            "DELETE FROM geofence_zones WHERE id = $1", zone_id
        )
        await conn.close()
        return {"status": "deleted"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

# ─── REST: Get alerts ─────────────────────────────────────────
@app.get("/alerts/{device_id}")
async def get_alerts(device_id: str):
    try:
        conn = await get_db()
        rows = await conn.fetch("""
            SELECT type, message, timestamp FROM alerts
            WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 50
        """, device_id)
        await conn.close()
        return [dict(r) for r in rows]
    except:
        return []

# ─── REST: Clear crash alerts ─────────────────────────────────
@app.delete("/alerts/{device_id}")
async def clear_alerts(device_id: str):
    try:
        conn = await get_db()
        await conn.execute(
            "DELETE FROM alerts WHERE device_id = $1", device_id
        )
        await conn.close()
        return {"status": "alerts cleared"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

# ─── Health check ─────────────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "GPS Tracker API running ✅"}

# ─── TCP Server for GPSFeed+ ──────────────────────────────────
async def handle_gpsfeed_client(reader, writer):
    device_id = "device_001"
    addr = writer.get_extra_info('peername')
    print(f"📡 GPSFeed+ connected from {addr}")

    try:
        while True:
            line = await reader.readline()
            if not line:
                break

            sentence = line.decode('utf-8', errors='ignore').strip()
            if not sentence:
                continue

            print(f"NMEA: {sentence}")

            lat, lon = parse_nmea(sentence)
            if lat is None:
                continue

            timestamp = time.time()
            speed, acceleration, jerk = calculate_analytics(device_id, lat, lon, timestamp)
            behaviour = classify_behaviour(speed)
            crash = abs(jerk) > 8 and abs(acceleration) > 4
            geofence_result = await check_geofence(device_id, lat, lon)

            state = device_state.get(device_id, {})
            stopped_duration = 0
            ask_stop_reason = False
            if state.get("stopped_since"):
                stopped_duration = timestamp - state["stopped_since"]
                if stopped_duration > 30:
                    ask_stop_reason = True

            payload = {
                "device_id": device_id,
                "lat": lat,
                "lon": lon,
                "speed": round(speed, 2),
                "acceleration": round(acceleration, 4),
                "jerk": round(jerk, 4),
                "behaviour": behaviour,
                "crash_detected": crash,
                "ask_stop_reason": ask_stop_reason,
                "stopped_duration": round(stopped_duration, 1),
                "timestamp": datetime.now().isoformat(),
                "geofence_alert": geofence_result["geofence_alert"],
                "geofence_zone": geofence_result["zone_name"],
                "geofence_message": geofence_result["message"]
            }

            try:
                conn = await get_db()
                await conn.execute("""
                    INSERT INTO gps_trail
                    (device_id, lat, lon, speed, acceleration, jerk, behaviour)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                """, device_id, lat, lon, speed, acceleration, jerk, behaviour)
                if crash:
                    await conn.execute("""
                        INSERT INTO alerts (device_id, type, message)
                        VALUES ($1, $2, $3)
                    """, device_id, "crash", f"Crash at {lat},{lon}")
                await conn.close()
            except Exception as e:
                print(f"DB write skipped: {e}")

            await manager.broadcast(payload)

    except Exception as e:
        print(f"GPSFeed+ disconnected: {e}")
    finally:
        writer.close()

async def start_tcp_server():
    server = await asyncio.start_server(
        handle_gpsfeed_client,
        '0.0.0.0',
        5005
    )
    print(f"✅ TCP Server listening on port 5005 for GPSFeed+")
    async with server:
        await server.serve_forever()

def parse_nmea(sentence: str):
    try:
        if "$GPRMC" in sentence or "$GNRMC" in sentence:
            parts = sentence.split(",")
            if parts[3] and parts[5]:
                raw_lat = parts[3]
                lat_deg = float(raw_lat[:2])
                lat_min = float(raw_lat[2:])
                lat = lat_deg + lat_min / 60
                if parts[4] == 'S':
                    lat = -lat
                raw_lon = parts[5]
                lon_deg = float(raw_lon[:3])
                lon_min = float(raw_lon[3:])
                lon = lon_deg + lon_min / 60
                if parts[6] == 'W':
                    lon = -lon
                return lat, lon
        return None, None
    except:
        return None, None