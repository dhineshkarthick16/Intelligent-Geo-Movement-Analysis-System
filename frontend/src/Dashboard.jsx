import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Tooltip, Legend
} from 'chart.js'
import { useState, useEffect } from 'react'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)

const behaviourColor = {
  stopped: '#64748b',
  slow: '#f59e0b',
  normal: '#22c55e',
  overspeed: '#ef4444'
}

const behaviourEmoji = {
  stopped: '🛑',
  slow: '🐢',
  normal: '✅',
  overspeed: '🚨'
}

export default function Dashboard({ gpsData, alerts, deviceId, deviceColor, onClearTrail, onClearAlerts, onZoneDeleted }) {
  const [speedHistory, setSpeedHistory] = useState([])
  const [labels, setLabels] = useState([])
  const [tripSummary, setTripSummary] = useState(null)

  // Reset chart when device changes
  useEffect(() => {
    setSpeedHistory([])
    setLabels([])
  }, [deviceId])

  useEffect(() => {
    if (!gpsData) return
    setSpeedHistory(prev => [...prev.slice(-20), gpsData.speed])
    setLabels(prev => [...prev.slice(-20), new Date().toLocaleTimeString()])
  }, [gpsData])

  const handleRestartTrail = async () => {
    const summary = await onClearTrail()
    if (summary) setTripSummary(summary)
  }

  const chartData = {
    labels,
    datasets: [{
      label: 'Speed (km/h)',
      data: speedHistory,
      borderColor: deviceColor || '#3b82f6',
      backgroundColor: (deviceColor || '#3b82f6') + '22',
      tension: 0.4,
      fill: true,
      pointRadius: 2
    }]
  }

  const chartOptions = {
    responsive: true,
    plugins: { legend: { labels: { color: '#94a3b8', fontSize: 11 } } },
    scales: {
      x: { ticks: { color: '#64748b', maxTicksLimit: 5 }, grid: { color: '#1e293b' } },
      y: { ticks: { color: '#64748b' }, grid: { color: '#334155' } }
    }
  }

  return (
    <div style={{ padding: 16, color: 'white' }}>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>

      {/* Header */}
      <h2 style={{ margin: '0 0 10px', fontSize: 16, color: deviceColor || '#94a3b8' }}>
        📡 GPS Dashboard — {deviceId}
      </h2>

      {/* Control Buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button onClick={handleRestartTrail} style={{
          flex: 1,
          background: '#1e40af',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: '8px 10px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600
        }}>
          🔄 Restart Trail
        </button>
        <button onClick={onClearAlerts} style={{
          flex: 1,
          background: '#7f1d1d',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: '8px 10px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600
        }}>
          🗑️ Clear Alerts
        </button>
      </div>

      {/* No data message */}
      {!gpsData && (
        <div style={{
          background: '#0f172a',
          borderRadius: 10,
          padding: 16,
          border: `1px solid ${deviceColor || '#334155'}`,
          textAlign: 'center',
          marginBottom: 14
        }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>🛰️</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            Waiting for {deviceId} data...
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
            Start this device in the simulator
          </div>
        </div>
      )}

      {/* Behaviour Badge */}
      {gpsData && (
        <div style={{
          background: behaviourColor[gpsData.behaviour] + '22',
          border: `1px solid ${behaviourColor[gpsData.behaviour]}`,
          borderRadius: 10,
          padding: '10px 14px',
          marginBottom: 14,
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 24 }}>{behaviourEmoji[gpsData.behaviour]}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: behaviourColor[gpsData.behaviour] }}>
            {gpsData.behaviour?.toUpperCase()}
          </div>
        </div>
      )}

      {/* Geofence Violation Badge */}
      {gpsData?.geofence_alert && (
        <div style={{
          background: '#ef444422',
          border: '2px solid #ef4444',
          borderRadius: 10,
          padding: '10px 14px',
          marginBottom: 14,
          textAlign: 'center',
          animation: 'pulse 1s infinite'
        }}>
          <div style={{ fontSize: 24 }}>⛔</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>
            RESTRICTED ZONE
          </div>
          <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 4 }}>
            ⚠️ Violated: {gpsData.geofence_zone}
          </div>
          <div style={{ fontSize: 11, color: '#f87171', marginTop: 4, fontWeight: 600 }}>
            LEAVE IMMEDIATELY
          </div>
        </div>
      )}

      {/* Stats Grid */}
      {gpsData && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Speed', value: `${gpsData.speed} km/h`, icon: '⚡' },
            { label: 'Latitude', value: gpsData.lat?.toFixed(5), icon: '📍' },
            { label: 'Longitude', value: gpsData.lon?.toFixed(5), icon: '📍' },
            { label: 'Acceleration', value: `${gpsData.acceleration} m/s²`, icon: '📈' },
            { label: 'Jerk', value: `${gpsData.jerk} m/s³`, icon: '📊' },
            { label: 'Crash', value: gpsData.crash_detected ? '⚠️ YES' : '✅ NO', icon: '🚗' },
          ].map(item => (
            <div key={item.label} style={{
              background: '#0f172a',
              borderRadius: 8,
              padding: '10px 12px',
              border: `1px solid ${deviceColor || '#334155'}22`
            }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                {item.icon} {item.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Speed Chart */}
      <div style={{
        background: '#0f172a',
        borderRadius: 10,
        padding: 12,
        border: '1px solid #334155',
        marginBottom: 14
      }}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
          Speed Over Time — {deviceId}
        </div>
        <Line data={chartData} options={chartOptions} />
      </div>

      {/* Geofence Zone Manager */}
      <GeofenceManager onZoneDeleted={onZoneDeleted} />

      {/* Alerts */}
      <div style={{
        background: '#0f172a',
        borderRadius: 10,
        padding: 12,
        border: '1px solid #334155'
      }}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
          🚨 Alerts ({alerts.length}) — {deviceId}
        </div>
        {alerts.length === 0 && (
          <div style={{ color: '#475569', fontSize: 13 }}>No alerts yet</div>
        )}
        {alerts.slice(0, 5).map((a, i) => (
          <div key={i} style={{
            background: '#1e293b',
            borderRadius: 6,
            padding: '8px 10px',
            marginBottom: 6,
            fontSize: 12,
            borderLeft: `3px solid ${deviceColor || '#ef4444'}`
          }}>
            <div style={{ color: '#fca5a5', fontWeight: 600 }}>{a.type?.toUpperCase()}</div>
            <div style={{ color: '#94a3b8' }}>{a.message}</div>
          </div>
        ))}
      </div>

      {/* Trip Summary Modal */}
      {tripSummary && (
        <TripSummaryModal
          summary={tripSummary}
          deviceColor={deviceColor}
          onClose={() => setTripSummary(null)}
        />
      )}

    </div>
  )
}

// ─── Trip Summary Modal ───────────────────────────────────────
function TripSummaryModal({ summary, deviceColor, onClose }) {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0,
      width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999
    }}>
      <div style={{
        background: '#1e293b',
        borderRadius: 16,
        padding: 28,
        width: 320,
        border: `1px solid ${deviceColor || '#334155'}`
      }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 32 }}>🏁</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'white', marginTop: 6 }}>
            Trip Summary
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Total Duration: {summary.duration}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {[
            { icon: '📏', label: 'Total Distance', value: `${summary.totalDistance} km` },
            { icon: '⚡', label: 'Max Speed', value: `${summary.maxSpeed} km/h` },
            { icon: '📊', label: 'Average Speed', value: `${summary.avgSpeed} km/h` },
            { icon: '🚗', label: 'Moving Time', value: summary.movingTime },
            { icon: '🛑', label: 'Stopped Time', value: summary.stoppedTime },
            { icon: '🚨', label: 'Alerts Triggered', value: summary.alertCount },
          ].map(item => (
            <div key={item.label} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#0f172a',
              borderRadius: 8,
              padding: '10px 14px',
              border: '1px solid #334155'
            }}>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>
                {item.icon} {item.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'white' }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <button onClick={onClose} style={{
          width: '100%',
          background: deviceColor || '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: '10px',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 600
        }}>
          ✅ Start New Trip
        </button>
      </div>
    </div>
  )
}

// ─── Geofence Zone Manager ────────────────────────────────────
function GeofenceManager({ onZoneDeleted }) {
  const [zones, setZones] = useState([])

  const loadZones = () => {
    fetch('http://localhost:8000/geofence')
      .then(r => r.json())
      .then(data => setZones(data))
      .catch(() => {})
  }

  useEffect(() => {
    loadZones()
  }, [])

  const deleteZone = async (id, name) => {
    if (!confirm(`Delete restricted zone "${name}"?`)) return
    await fetch(`http://localhost:8000/geofence/${id}`, {
      method: 'DELETE'
    })
    loadZones()
    onZoneDeleted()
  }

  return (
    <div style={{
      background: '#0f172a',
      borderRadius: 10,
      padding: 12,
      border: '1px solid #334155',
      marginBottom: 14
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8
      }}>
        <div style={{ fontSize: 12, color: '#64748b' }}>
          🚫 Restricted Zones ({zones.length})
        </div>
        <button onClick={loadZones} style={{
          background: '#334155',
          color: '#94a3b8',
          border: 'none',
          borderRadius: 4,
          padding: '3px 8px',
          cursor: 'pointer',
          fontSize: 11
        }}>
          🔄 Refresh
        </button>
      </div>

      {zones.length === 0 && (
        <div style={{ color: '#475569', fontSize: 13 }}>
          No zones saved yet
        </div>
      )}

      {zones.map(zone => (
        <div key={zone.id} style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#1e293b',
          borderRadius: 6,
          padding: '8px 10px',
          marginBottom: 6,
          borderLeft: '3px solid #ef4444'
        }}>
          <div>
            <div style={{ color: '#fca5a5', fontWeight: 600, fontSize: 12 }}>
              🚫 {zone.name}
            </div>
            <div style={{ color: '#475569', fontSize: 11 }}>
              ID: {zone.id}
            </div>
          </div>
          <button onClick={() => deleteZone(zone.id, zone.name)} style={{
            background: '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            padding: '5px 10px',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600
          }}>
            🗑️ Delete
          </button>
        </div>
      ))}
    </div>
  )
}