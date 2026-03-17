import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import axios from 'axios'

const behaviourColor = {
  stopped: '#64748b',
  slow: '#f59e0b',
  normal: '#22c55e',
  overspeed: '#ef4444'
}

const DEVICE_CONFIGS = [
  { id: 'device_001', color: '#3b82f6' },
  { id: 'device_002', color: '#22c55e' },
  { id: 'device_003', color: '#f59e0b' },
]

export default function Map({ gpsData, trail, deviceId, zoneVersion }) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markerRef = useRef(null)
  const polylineRef = useRef(null)
  const geofenceRef = useRef(null)
  const zoneLayersRef = useRef([])
  const deviceMarkersRef = useRef({})
  const mapSocketsRef = useRef([])
  const [geofenceName, setGeofenceName] = useState('')
  const [drawing, setDrawing] = useState(false)
  const [geofencePoints, setGeofencePoints] = useState([])
  const tempMarkersRef = useRef([])

  // ─── Initialize map ────────────────────────────────────────
  useEffect(() => {
    if (mapInstance.current) return

    mapInstance.current = L.map(mapRef.current).setView([13.0827, 80.2707], 13)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(mapInstance.current)

    // Main selected device marker (blue by default)
    markerRef.current = L.circleMarker([13.0827, 80.2707], {
      radius: 10, color: '#3b82f6',
      fillColor: '#3b82f6', fillOpacity: 1
    }).addTo(mapInstance.current)

    polylineRef.current = L.polyline([], {
      color: '#22c55e', weight: 3, opacity: 0.8
    }).addTo(mapInstance.current)

  }, [])

  // ─── Independent WebSockets for ALL device map markers ─────
  useEffect(() => {
    if (!mapInstance.current) return

    // Close old sockets
    mapSocketsRef.current.forEach(ws => ws.close())
    mapSocketsRef.current = []

    DEVICE_CONFIGS.forEach(device => {
      const ws = new WebSocket(`ws://localhost:8000/ws/map_${device.id}`)

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.device_id !== device.id) return

        const pos = [data.lat, data.lon]
        const color = device.id === deviceId
          ? (behaviourColor[data.behaviour] || device.color)
          : device.color

        if (deviceMarkersRef.current[device.id]) {
          deviceMarkersRef.current[device.id].setLatLng(pos)
          deviceMarkersRef.current[device.id].setStyle({
            color, fillColor: color
          })
          deviceMarkersRef.current[device.id].bindPopup(`
            📡 ${device.id}<br/>
            Speed: ${data.speed} km/h<br/>
            ${data.behaviour?.toUpperCase()}
          `)
        } else {
          deviceMarkersRef.current[device.id] = L.circleMarker(pos, {
            radius: device.id === deviceId ? 12 : 8,
            color, fillColor: color, fillOpacity: 1
          }).bindPopup(`📡 ${device.id}`)
            .addTo(mapInstance.current)
        }

        // Pan map to selected device
        if (device.id === deviceId) {
          mapInstance.current.panTo(pos)
        }
      }

      mapSocketsRef.current.push(ws)
    })

    return () => {
      mapSocketsRef.current.forEach(ws => ws.close())
      mapSocketsRef.current = []
    }
  }, [deviceId])

  // ─── Reload zones when zoneVersion changes ─────────────────
  useEffect(() => {
    if (!mapInstance.current) return

    zoneLayersRef.current.forEach(layer => layer.remove())
    zoneLayersRef.current = []

    fetch('http://localhost:8000/geofence')
      .then(r => r.json())
      .then(zones => {
        zones.forEach(zone => {
          const coords = JSON.parse(zone.coordinates)
          const polygon = L.polygon(coords, {
            color: '#ef4444',
            fillColor: '#ef4444',
            fillOpacity: 0.15,
            weight: 2,
            dashArray: '6, 6'
          }).bindPopup(`🚫 ${zone.name}`)
            .addTo(mapInstance.current)
          zoneLayersRef.current.push(polygon)
        })
      })
      .catch(() => {})
  }, [zoneVersion])

  // ─── Update trail polyline ─────────────────────────────────
  useEffect(() => {
    if (!polylineRef.current || trail.length === 0) return
    const latlngs = trail.map(p => [p.lat, p.lon])
    polylineRef.current.setLatLngs(latlngs)
  }, [trail])

  // ─── Clear trail polyline when restarted ──────────────────
  useEffect(() => {
    if (!polylineRef.current) return
    if (trail.length === 0) {
      polylineRef.current.setLatLngs([])
    }
  }, [trail])

  // ─── Handle geofence drawing click ────────────────────────
  useEffect(() => {
    if (!mapInstance.current) return

    const handleClick = (e) => {
      if (!drawing) return
      const { lat, lng } = e.latlng
      setGeofencePoints(prev => [...prev, [lat, lng]])
      const m = L.circleMarker([lat, lng], {
        radius: 5, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1
      }).addTo(mapInstance.current)
      tempMarkersRef.current.push(m)
    }

    mapInstance.current.on('click', handleClick)
    return () => mapInstance.current.off('click', handleClick)
  }, [drawing])

  const saveGeofence = async () => {
    if (geofencePoints.length < 3) {
      alert('Click at least 3 points on the map to draw a zone!')
      return
    }
    await axios.post('http://localhost:8000/geofence', {
      name: geofenceName || 'Zone 1',
      coordinates: geofencePoints
    })

    if (geofenceRef.current) geofenceRef.current.remove()
    geofenceRef.current = L.polygon(geofencePoints, {
      color: '#ef4444', fillColor: '#ef4444',
      fillOpacity: 0.15, weight: 2, dashArray: '6, 6'
    }).bindPopup(`🚫 ${geofenceName || 'Zone 1'}`)
      .addTo(mapInstance.current)

    zoneLayersRef.current.push(geofenceRef.current)

    tempMarkersRef.current.forEach(m => m.remove())
    tempMarkersRef.current = []
    setGeofencePoints([])
    setDrawing(false)
    alert(`Restricted Zone "${geofenceName || 'Zone 1'}" saved!`)
    setGeofenceName('')
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Device Legend */}
      <div style={{
        position: 'absolute', top: 50, right: 12, zIndex: 1000,
        background: '#1e293b', borderRadius: 10, padding: 10,
        border: '1px solid #334155'
      }}>
        {DEVICE_CONFIGS.map(device => (
          <div key={device.id} style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6
          }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: device.color,
              boxShadow: device.id === deviceId ? `0 0 6px ${device.color}` : 'none'
            }} />
            <span style={{
              fontSize: 11,
              color: device.id === deviceId ? device.color : '#64748b',
              fontWeight: device.id === deviceId ? 700 : 400
            }}>
              {device.id}
            </span>
          </div>
        ))}
      </div>

      {/* Geofence Controls */}
      <div style={{
        position: 'absolute', bottom: 20, left: 12, zIndex: 1000,
        background: '#1e293b', borderRadius: 10, padding: 12,
        border: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: 8
      }}>
        <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8, fontWeight: 600 }}>
          🚫 Restricted Zone
        </div>
        <input
          placeholder="Zone name"
          value={geofenceName}
          onChange={e => setGeofenceName(e.target.value)}
          style={{
            background: '#0f172a', border: '1px solid #334155',
            borderRadius: 6, padding: '6px 10px', color: 'white', fontSize: 12
          }}
        />
        <button onClick={() => setDrawing(!drawing)} style={{
          background: drawing ? '#ef4444' : '#334155',
          color: 'white', border: 'none', borderRadius: 6,
          padding: '6px 12px', cursor: 'pointer', fontSize: 12
        }}>
          {drawing ? '📍 Click map to add points...' : '✏️ Start Drawing'}
        </button>
        {geofencePoints.length > 0 && (
          <button onClick={saveGeofence} style={{
            background: '#22c55e', color: 'white', border: 'none',
            borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12
          }}>
            💾 Save Zone ({geofencePoints.length} pts)
          </button>
        )}
      </div>

      {/* Multi-Device GPS Simulator */}
      <GPSSimulator />
    </div>
  )
}

// ─── Multi-Device GPS Simulator ───────────────────────────────
function GPSSimulator() {
  const devicesRef = useRef([
    { id: 'device_001', color: '#3b82f6', pos: { lat: 13.0827, lon: 80.2707 } },
    { id: 'device_002', color: '#22c55e', pos: { lat: 13.0900, lon: 80.2800 } },
    { id: 'device_003', color: '#f59e0b', pos: { lat: 13.0750, lon: 80.2600 } },
  ])
  const wsRefs = useRef({})
  const intervalRefs = useRef({})
  const [activeDevices, setActiveDevices] = useState({})

  const toggle = (device) => {
    const id = device.id
    if (activeDevices[id]) {
      clearInterval(intervalRefs.current[id])
      wsRefs.current[id]?.close()
      setActiveDevices(prev => ({ ...prev, [id]: false }))
    } else {
      const ws = new WebSocket(`ws://localhost:8000/ws/${id}`)
      wsRefs.current[id] = ws
      ws.onopen = () => {
        intervalRefs.current[id] = setInterval(() => {
          device.pos.lat += (Math.random() - 0.5) * 0.001
          device.pos.lon += (Math.random() - 0.5) * 0.001
          ws.send(JSON.stringify({
            lat: device.pos.lat,
            lon: device.pos.lon
          }))
        }, 1000)
        setActiveDevices(prev => ({ ...prev, [id]: true }))
      }
    }
  }

  return (
    <div style={{
      position: 'absolute', top: 50, left: 12, zIndex: 1000,
      background: '#1e293b', borderRadius: 10, padding: 12,
      border: '1px solid #334155', minWidth: 170
    }}>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, fontWeight: 600 }}>
        🛰️ GPS Devices
      </div>
      {devicesRef.current.map((device) => (
        <div key={device.id} style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: 8
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: device.color,
              boxShadow: activeDevices[device.id]
                ? `0 0 6px ${device.color}` : 'none'
            }} />
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{device.id}</span>
          </div>
          <button onClick={() => toggle(device)} style={{
            background: activeDevices[device.id] ? '#ef4444' : '#22c55e',
            color: 'white', border: 'none', borderRadius: 4,
            padding: '3px 10px', cursor: 'pointer',
            fontSize: 11, fontWeight: 600
          }}>
            {activeDevices[device.id] ? '⏹ Stop' : '▶ Start'}
          </button>
        </div>
      ))}
    </div>
  )
}