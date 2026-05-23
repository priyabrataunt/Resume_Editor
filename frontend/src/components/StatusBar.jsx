export default function StatusBar({
  activeProfileName,
  fileName,
  lastCompileTime,
  pendingCount,
  acceptedCount,
  rejectedCount,
  atsScore,
  projectedScore,
  scoreBreakdown,
  baselineAts,
  personaActive,
  personaSource,
  personaChars,
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
  const showBreakdown = atsScore != null && scoreBreakdown;
  const experienceLow = showBreakdown && scoreBreakdown.experience_alignment < 50;
  const showProjected =
    projectedScore != null &&
    atsScore != null &&
    projectedScore > atsScore &&
    pendingCount > 0;

  const breakdownPill = (label, value) => (
    <span
      key={label}
      style={{
        padding: '1px 7px',
        borderRadius: 4,
        background: 'rgba(99, 102, 241, 0.1)',
        border: '1px solid rgba(99, 102, 241, 0.2)',
        color: value < 50 ? '#fca5a5' : value < 70 ? '#fcd34d' : '#86efac',
        fontSize: 10,
        fontWeight: 600,
      }}
      title={`${label}: ${value}/100`}
    >
      {label} {value}
    </span>
  );

  return (
    <div style={{
      background: 'linear-gradient(180deg, #0e0e18 0%, #0c0c14 100%)',
      borderTop: '1px solid rgba(99, 102, 241, 0.12)',
      flexShrink: 0,
      userSelect: 'none',
      fontVariantNumeric: 'tabular-nums',
    }}>
      <div style={{
        minHeight: 28,
        display: 'flex',
        alignItems: 'center',
        padding: '4px 14px',
        gap: 10,
        fontSize: 11,
        color: '#7c8498',
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
            <span style={{ color: '#c4b5fd' }}>ATS baseline {baselineAts}</span>
          </>
        )}

        {atsScore != null && (
          <>
            {sep}
            <span style={{ color: '#8b92a8' }} title="Score for your resume before applying pending suggestions">
              Current fit
            </span>
            <span style={{ color: atsColor(atsScore), fontWeight: 700 }}>
              {atsScore}/100
            </span>
            {showProjected && (
              <span style={{ color: '#86efac', fontWeight: 600 }} title="Estimated fit if you apply all pending suggestions">
                → ~{projectedScore} if applied
              </span>
            )}
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
          title={
            personaActive
              ? `Active persona — Writing model rewrites every suggestion in your voice.\nSource: ${personaSource ?? 'unknown'}\nSize: ${personaChars ?? 0} chars\nClick to refresh.`
              : 'No persona loaded'
          }
        >
          {personaActive
            ? `Persona on${personaSource && personaSource !== 'none' ? ` · ${personaSource}` : ''}`
            : 'Persona off'}
        </span>
      </div>

      {showBreakdown && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          padding: '0 14px 6px',
          fontSize: 10,
          color: '#7c8498',
        }}>
          <span style={{ color: '#6b728a', marginRight: 2 }}>Breakdown</span>
          {breakdownPill('Keywords', scoreBreakdown.keyword_coverage)}
          {breakdownPill('Experience', scoreBreakdown.experience_alignment)}
          {breakdownPill('Skills', scoreBreakdown.skills_match)}
          {breakdownPill('Format', scoreBreakdown.formatting_ats_safety)}
          {experienceLow && (
            <span style={{
              color: '#fbbf24',
              fontSize: 10,
              marginLeft: 4,
              fontWeight: 500,
            }}>
              Experience gap — keyword edits alone may not reach 85+
            </span>
          )}
        </div>
      )}
    </div>
  );
}
