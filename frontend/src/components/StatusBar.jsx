export default function StatusBar({
  activeProfileName,
  fileName,
  lastCompileTime,
  pendingCount,
  acceptedCount,
  rejectedCount,
  atsScore,
  scoreBreakdown,
  baselineAts,
  personaActive,
  onRefreshPersona,
}) {
  function formatTime(date) {
    if (!date) return null;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function atsColor(score) {
    if (score >= 70) return '#4ade80';
    if (score >= 40) return '#fbbf24';
    return '#f87171';
  }

  const sep = <span style={{ color: '#3d3d52', userSelect: 'none' }} aria-hidden>·</span>;

  return (
    <div style={{
      height: 28,
      background: 'linear-gradient(180deg, #0e0e18 0%, #0c0c14 100%)',
      borderTop: '1px solid rgba(99, 102, 241, 0.12)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 14px',
      gap: 10,
      fontSize: 11,
      color: '#7c8498',
      flexShrink: 0,
      userSelect: 'none',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {activeProfileName && (
        <>
          <span style={{ color: '#a8b3cc', fontWeight: 600, letterSpacing: '-0.02em' }} title="Active resume profile">
            {activeProfileName}
          </span>
          {sep}
        </>
      )}
      <span style={{ color: '#6b728a' }}>{fileName}</span>

      {lastCompileTime && (
        <>
          {sep}
          <span style={{ color: '#8b92a8' }}>Compiled {formatTime(lastCompileTime)}</span>
        </>
      )}

      {baselineAts != null && (
        <>
          {sep}
          <span style={{ color: '#c4b5fd' }}>
            ATS baseline {baselineAts}
          </span>
        </>
      )}
      {atsScore != null && (
        <>
          {sep}
          <span
            style={{ color: atsColor(atsScore), fontWeight: 600, cursor: scoreBreakdown ? 'help' : 'default' }}
            title={scoreBreakdown
              ? `Keywords: ${scoreBreakdown.keyword_coverage} | Experience: ${scoreBreakdown.experience_alignment} | Skills: ${scoreBreakdown.skills_match} | Format: ${scoreBreakdown.formatting_ats_safety}`
              : undefined}
          >
            ATS {atsScore}/100
          </span>
        </>
      )}

      {sep}
      <span>
        <span style={{ color: '#fcd34d' }}>{pendingCount} pending</span>
        {acceptedCount > 0 && <span style={{ color: '#86efac' }}> · {acceptedCount} accepted</span>}
        {rejectedCount > 0 && <span style={{ color: '#fca5a5' }}> · {rejectedCount} rejected</span>}
      </span>

      <span
        style={{
          marginLeft: 'auto',
          color: personaActive ? '#c4b5fd' : '#5c6370',
          cursor: personaActive ? 'pointer' : 'default',
          padding: '2px 0',
        }}
        onClick={personaActive ? onRefreshPersona : undefined}
        onKeyDown={personaActive ? (e) => { if (e.key === 'Enter' || e.key === ' ') onRefreshPersona?.(); } : undefined}
        role={personaActive ? 'button' : undefined}
        tabIndex={personaActive ? 0 : undefined}
        title={personaActive ? 'Click to refresh persona' : 'No persona loaded'}
      >
        {personaActive ? 'Persona on' : 'Persona off'}
      </span>
    </div>
  );
}
