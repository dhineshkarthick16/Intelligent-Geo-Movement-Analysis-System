import { useState } from 'react'

export default function StopReasonModal({ deviceId, lat, lon }) {
  const [submitted, setSubmitted] = useState(false)

  const reasons = ['Traffic', 'Signal', 'Break', 'Parking', 'Other']

  const handleReason = async (reason) => {
    await fetch('http://localhost:8000/stop-reason', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, reason, lat, lon })
    })
    setSubmitted(true)
  }

  if (submitted) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0,
      width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999
    }}>
      <div style={{
        background: '#1e293b', borderRadius: 16,
        padding: 32, width: 320,
        border: '1px solid #334155'
      }}>
        <div style={{ fontSize: 28, textAlign: 'center', marginBottom: 8 }}>🛑</div>
        <h3 style={{ color: 'white', textAlign: 'center', margin: '0 0 8px' }}>
          Vehicle Stopped
        </h3>
        <p style={{ color: '#94a3b8', textAlign: 'center', fontSize: 14, margin: '0 0 20px' }}>
          Why did you stop?
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reasons.map(r => (
            <button key={r} onClick={() => handleReason(r)} style={{
              background: '#334155', color: 'white',
              border: '1px solid #475569', borderRadius: 8,
              padding: '10px 16px', cursor: 'pointer',
              fontSize: 14, fontWeight: 500,
              transition: 'background 0.2s'
            }}
              onMouseOver={e => e.target.style.background = '#3b82f6'}
              onMouseOut={e => e.target.style.background = '#334155'}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}