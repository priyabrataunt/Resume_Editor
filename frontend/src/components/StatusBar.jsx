export default function StatusBar({
  fileName,
  lastCompileTime,
  pendingCount,
  acceptedCount,
  rejectedCount,
  projectedAtsDelta,
  baselineAts,
  personaActive,
  onRefreshPersona,
}) {
  function formatTime(date) {
    if (!date) return null;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  return (
    <div style={{
      height: 26,
      background: '#0e0e1a',
      borderTop: '1px solid #1a1a2e',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 18,
      fontSize: 11,
      color: '#555',
      flexShrink: 0,
      userSelect: 'none',
    }}>
      <span style={{ color: '#444' }}>{fileName}</span>

      {lastCompileTime && (
        <span>compiled {formatTime(lastCompileTime)}</span>
      )}

      {baselineAts != null && projectedAtsDelta > 0 ? (
        <span style={{ color: '#4ade80' }}>
          ATS {baselineAts} → {baselineAts + projectedAtsDelta} (+{projectedAtsDelta} pts)
        </span>
      ) : baselineAts != null ? (
        <span style={{ color: '#a78bfa' }}>
          ATS baseline {baselineAts}
        </span>
      ) : projectedAtsDelta > 0 ? (
        <span style={{ color: '#4ade80' }}>
          ATS +{projectedAtsDelta} pts projected
        </span>
      ) : null}

      <span>
        <span style={{ color: '#fbbf24' }}>{pendingCount} pending</span>
        {acceptedCount > 0 && <span style={{ color: '#4ade80' }}> · {acceptedCount} accepted</span>}
        {rejectedCount > 0 && <span style={{ color: '#f87171' }}> · {rejectedCount} rejected</span>}
      </span>

      <span
        style={{
          color: personaActive ? '#a78bfa' : '#444',
          cursor: personaActive ? 'pointer' : 'default',
        }}
        onClick={personaActive ? onRefreshPersona : undefined}
        title={personaActive ? 'Click to refresh persona' : 'No persona loaded'}
      >
        {personaActive ? '● persona active' : '○ no persona'}
      </span>
    </div>
  );
}
