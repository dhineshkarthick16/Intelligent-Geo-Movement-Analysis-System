import { useState, useEffect, useRef } from 'react'
import Map from './Map'
import Dashboard from './Dashboard'
import StopReasonModal from './StopReasonModal'
import useGPS from './useGPS'

const DEVICES = [
  { id: 'device_001', color: '#3b82f6', label: 'Device 1' },
  { id: 'device_002', color: '#22c55e', label: 'Device 2' },
  { id: 'device_003', color: '#f59e0b', label: 'Device 3' },
]

function App() {
  const [selectedDevice, setSelectedDevice] = useState('device_001')
  const [zoneVersion, setZoneVersion] = useState(0)
  const { gpsData, trail, alerts, isConnected, clearTrail, clearAlerts } = useGPS(selectedDevice)
  const prevCrash = useRef(false)
  const prevGeofence = useRef(false)

  // ─── Sound alerts ──────────────────────────────────────────
  const playBeep = (frequency, duration, times) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    let delay = 0
    for (let i = 0; i < times; i++) {
      const oscillator = ctx.createOscillator()
      const gainNode = ctx.createGain()
      oscillator.connect(gainNode)
      gainNode.connect(ctx.destination)
      oscillator.frequency.value = frequency
      oscillator.type = 'sine'
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime + delay)
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration)
      oscillator.start(ctx.currentTime + delay)
      oscillator.stop(ctx.currentTime + delay + duration)
      delay += duration + 0.1
    }
  }

  useEffect(() => {
    if (!gpsData) return
    if (gpsData.crash_detected && !prevCrash.current) {
      playBeep(880, 0.3, 3)
    }
    prevCrash.current = gpsData.crash_detected
    if (gpsData.geofence_alert && !prevGeofence.current) {
      playBeep(440, 0.6, 2)
    }
    prevGeofence.current = gpsData.geofence_alert
  }, [gpsData])

  const handleZoneDeleted = () => {
    setZoneVersion(prev => prev + 1)
  }

  const selectedDeviceInfo = DEVICES.find(d => d.id === selectedDevice)

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      fontFamily: 'sans-serif',
      background: '#0f172a'
    }}>

      {/* Left: Map */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Map
          gpsData={gpsData}
          trail={trail}
          deviceId={selectedDevice}
          zoneVersion={zoneVersion}
        />

        {/* Connection badge */}
        <div style={{
          position: 'absolute', top: 12, left: 12, zIndex: 1000,
          background: isConnected ? '#22c55e' : '#ef4444',
          color: 'white', padding: '4px 12px',
          borderRadius: 20, fontSize: 13, fontWeight: 600
        }}>
          {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>

        {/* Sound indicator */}
        <div style={{
          position: 'absolute', top: 12, right: 12, zIndex: 1000,
          background: '#1e293b', color: '#94a3b8',
          padding: '4px 12px', borderRadius: 20, fontSize: 12,
          border: '1px solid #334155'
        }}>
          🔊 Sound On
        </div>
      </div>

      {/* Right: Dashboard */}
      <div style={{ width: 340, overflowY: 'auto', background: '#1e293b' }}>

        {/* Device Selector */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #334155',
          background: '#0f172a'
        }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
            📡 SELECT DEVICE TO MONITOR
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {DEVICES.map(device => (
              <button
                key={device.id}
                onClick={() => setSelectedDevice(device.id)}
                style={{
                  flex: 1,
                  background: selectedDevice === device.id
                    ? device.color + '33'
                    : '#1e293b',
                  color: selectedDevice === device.id
                    ? device.color
                    : '#64748b',
                  border: `2px solid ${selectedDevice === device.id
                    ? device.color
                    : '#334155'}`,
                  borderRadius: 8,
                  padding: '8px 4px',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                  transition: 'all 0.2s'
                }}
              >
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: device.color,
                  margin: '0 auto 4px',
                  boxShadow: selectedDevice === device.id
                    ? `0 0 6px ${device.color}`
                    : 'none'
                }} />
                {device.label}
              </button>
            ))}
          </div>
        </div>

        <Dashboard
          gpsData={gpsData}
          alerts={alerts}
          deviceId={selectedDevice}
          deviceColor={selectedDeviceInfo?.color}
          onClearTrail={clearTrail}
          onClearAlerts={clearAlerts}
          onZoneDeleted={handleZoneDeleted}
        />
      </div>

      {/* Stop Reason Modal */}
      {gpsData?.ask_stop_reason && (
        <StopReasonModal
          deviceId={selectedDevice}
          lat={gpsData.lat}
          lon={gpsData.lon}
        />
      )}
    </div>
  )
}

export default App