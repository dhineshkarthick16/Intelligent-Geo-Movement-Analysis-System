import { useState, useEffect, useRef } from 'react'

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const phi1 = lat1 * Math.PI / 180
  const phi2 = lat2 * Math.PI / 180
  const dphi = (lat2 - lat1) * Math.PI / 180
  const dlambda = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dphi/2)**2 + Math.cos(phi1)*Math.cos(phi2)*Math.sin(dlambda/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export default function useGPS(deviceId) {
  const [gpsData, setGpsData] = useState(null)
  const [trail, setTrail] = useState([])
  const [alerts, setAlerts] = useState([])
  const [isConnected, setIsConnected] = useState(false)
  const ws = useRef(null)
  const stopReasonShown = useRef(false)

  // ─── Trip stats refs ───────────────────────────────────────
  const tripStats = useRef({
    totalDistance: 0,
    maxSpeed: 0,
    stoppedSeconds: 0,
    movingSeconds: 0,
    speedSum: 0,
    pointCount: 0,
    alertCount: 0,
    lastPoint: null,
    lastTimestamp: null,
    startTime: Date.now()
  })

  // Reset state when device changes
  useEffect(() => {
    setGpsData(null)
    setTrail([])
    setAlerts([])
    setIsConnected(false)
    tripStats.current = {
      totalDistance: 0,
      maxSpeed: 0,
      stoppedSeconds: 0,
      movingSeconds: 0,
      speedSum: 0,
      pointCount: 0,
      alertCount: 0,
      lastPoint: null,
      lastTimestamp: null,
      startTime: Date.now()
    }
  }, [deviceId])

  useEffect(() => {
    // Load existing trail
    fetch(`http://localhost:8000/trail/${deviceId}`)
      .then(r => r.json())
      .then(data => {
        if (data.length > 0) {
          setTrail(data.map(p => ({ lat: p.lat, lon: p.lon })))
        }
      })
      .catch(() => {})

    // Load existing alerts
    fetch(`http://localhost:8000/alerts/${deviceId}`)
      .then(r => r.json())
      .then(data => {
        setAlerts(data)
        tripStats.current.alertCount = data.length
      })
      .catch(() => {})

    // Connect WebSocket
    ws.current = new WebSocket(`ws://localhost:8000/ws/${deviceId}`)

    ws.current.onopen = () => {
      setIsConnected(true)
      console.log(`WebSocket connected: ${deviceId}`)
    }

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data)

      // ✅ Only process data for the selected device
      if (data.device_id !== deviceId) return

      setGpsData(data)
      setTrail(prev => [...prev, { lat: data.lat, lon: data.lon }])

      // ─── Update trip stats ─────────────────────────────────
      const stats = tripStats.current
      const now = Date.now()

      // Distance
      if (stats.lastPoint) {
        const d = haversine(
          stats.lastPoint.lat, stats.lastPoint.lon,
          data.lat, data.lon
        )
        stats.totalDistance += d
      }
      stats.lastPoint = { lat: data.lat, lon: data.lon }

      // Max speed
      if (data.speed > stats.maxSpeed) {
        stats.maxSpeed = data.speed
      }

      // Stopped vs moving time
      if (stats.lastTimestamp) {
        const dt = (now - stats.lastTimestamp) / 1000
        if (data.behaviour === 'stopped') {
          stats.stoppedSeconds += dt
        } else {
          stats.movingSeconds += dt
        }
      }
      stats.lastTimestamp = now

      // Average speed
      stats.speedSum += data.speed
      stats.pointCount += 1

      // Crash alerts
      if (data.crash_detected) {
        stats.alertCount += 1
        setAlerts(prev => [{
          type: 'crash',
          message: `Crash detected at ${data.lat.toFixed(4)}, ${data.lon.toFixed(4)}`,
          timestamp: data.timestamp
        }, ...prev])
      }

      if (data.behaviour !== 'stopped') {
        stopReasonShown.current = false
      }
    }

    ws.current.onclose = () => {
      setIsConnected(false)
      console.log(`WebSocket disconnected: ${deviceId}`)
    }

    return () => ws.current?.close()
  }, [deviceId])

  // ─── Clear trail + return summary ─────────────────────────
  const clearTrail = async () => {
    const stats = tripStats.current

    const summary = {
      totalDistance: (stats.totalDistance / 1000).toFixed(2),
      maxSpeed: stats.maxSpeed.toFixed(1),
      avgSpeed: stats.pointCount > 0
        ? (stats.speedSum / stats.pointCount).toFixed(1)
        : '0.0',
      stoppedTime: formatTime(stats.stoppedSeconds),
      movingTime: formatTime(stats.movingSeconds),
      alertCount: stats.alertCount,
      duration: formatTime((Date.now() - stats.startTime) / 1000)
    }

    await fetch(`http://localhost:8000/trail/${deviceId}`, {
      method: 'DELETE'
    })

    setTrail([])
    tripStats.current = {
      totalDistance: 0,
      maxSpeed: 0,
      stoppedSeconds: 0,
      movingSeconds: 0,
      speedSum: 0,
      pointCount: 0,
      alertCount: 0,
      lastPoint: null,
      lastTimestamp: null,
      startTime: Date.now()
    }

    return summary
  }

  // ─── Clear alerts ──────────────────────────────────────────
  const clearAlerts = async () => {
    await fetch(`http://localhost:8000/alerts/${deviceId}`, {
      method: 'DELETE'
    })
    setAlerts([])
    tripStats.current.alertCount = 0
  }

  const sendGPS = (lat, lon) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ lat, lon }))
    }
  }

  return { gpsData, trail, alerts, isConnected, sendGPS, clearTrail, clearAlerts }
}

function formatTime(seconds) {
  const s = Math.floor(seconds)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`
}