import { useEffect, useRef } from 'react';

const S = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    pointerEvents: 'none',
  },
  popup: {
    position: 'absolute',
    width: 520,
    background: '#1e1e2e',
    border: '1px solid #3d3d5c',
    borderRadius: 10,
    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
    pointerEvents: 'all',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px 8px',
    borderBottom: '1px solid #2d2d4a',
    background: '#16162a',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: '#888',
  },
  atsDelta: {
    padding: '2px 8px',
    borderRadius: 12,
    background: 'rgba(74, 222, 128, 0.15)',
    color: '#4ade80',
    fontWeight: 700,
    fontSize: 12,
    border: '1px solid rgba(74, 222, 128, 0.3)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#666',
    cursor: 'pointer',
    fontSize: 18,
    lineHeight: 1,
    padding: '0 2px',
  },
  body: {
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  blockLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  oldBlock: {
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid rgba(239, 68, 68, 0.25)',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 13,
    lineHeight: 1.5,
    color: '#fca5a5',
    textDecoration: 'line-through',
    opacity: 0.8,
    fontFamily: 'monospace',
    wordBreak: 'break-word',
  },
  newBlock: {
    background: 'rgba(74, 222, 128, 0.08)',
    border: '1px solid rgba(74, 222, 128, 0.3)',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 13,
    lineHeight: 1.5,
    color: '#86efac',
    fontFamily: 'monospace',
    wordBreak: 'break-word',
  },
  reason: {
    fontSize: 12,
    color: '#888',
    lineHeight: 1.5,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 6,
    borderLeft: '3px solid #3d3d5c',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderTop: '1px solid #2d2d4a',
    background: '#16162a',
    gap: 8,
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: '#888',
  },
  navBtn: {
    background: 'none',
    border: '1px solid #3d3d5c',
    borderRadius: 4,
    color: '#ccc',
    cursor: 'pointer',
    padding: '2px 8px',
    fontSize: 14,
    lineHeight: 1.4,
  },
  actions: {
    display: 'flex',
    gap: 8,
  },
  keepNewBtn: {
    padding: '6px 16px',
    background: '#16a34a',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
  keepOldBtn: {
    padding: '6px 16px',
    background: '#2d2d4a',
    border: '1px solid #3d3d5c',
    borderRadius: 6,
    color: '#aaa',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
  },
};

export default function SuggestionPopup({
  suggestions,
  currentIndex,
  position, // { x, y }
  onNavigate,
  onKeepNew,
  onKeepOld,
  onClose,
}) {
  const popupRef = useRef(null);

  if (!suggestions.length) return null;

  const suggestion = suggestions[currentIndex];
  const total = suggestions.length;

  // Clamp popup position to viewport
  const POPUP_WIDTH = 520;
  const POPUP_HEIGHT = 320; // approximate
  const MARGIN = 12;
  const x = Math.min(position.x, window.innerWidth - POPUP_WIDTH - MARGIN);
  const y = Math.min(position.y, window.innerHeight - POPUP_HEIGHT - MARGIN);

  return (
    <div style={S.overlay}>
      <div ref={popupRef} style={{ ...S.popup, left: Math.max(MARGIN, x), top: Math.max(MARGIN, y) }}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.headerLeft}>
            <span style={{ color: '#ccc', fontWeight: 600 }}>{suggestion.section}</span>
            <span>·</span>
            <span>Line {suggestion.line}</span>
            {suggestion.ats_delta > 0 && (
              <span style={S.atsDelta}>ATS +{suggestion.ats_delta} pts</span>
            )}
          </div>
          <button style={S.closeBtn} onClick={onClose} title="Close">×</button>
        </div>

        {/* Body */}
        <div style={S.body}>
          <div>
            <div style={{ ...S.blockLabel, color: '#f87171' }}>OLD</div>
            <div style={S.oldBlock}>{suggestion.old}</div>
          </div>
          <div>
            <div style={{ ...S.blockLabel, color: '#4ade80' }}>NEW</div>
            <div style={S.newBlock}>{suggestion.new}</div>
          </div>
          {suggestion.reason && (
            <div style={S.reason}>{suggestion.reason}</div>
          )}
        </div>

        {/* Footer */}
        <div style={S.footer}>
          <div style={S.nav}>
            <button
              style={{ ...S.navBtn, opacity: currentIndex === 0 ? 0.4 : 1 }}
              disabled={currentIndex === 0}
              onClick={() => onNavigate(-1)}
            >
              ‹
            </button>
            <span>{currentIndex + 1} of {total}</span>
            <button
              style={{ ...S.navBtn, opacity: currentIndex === total - 1 ? 0.4 : 1 }}
              disabled={currentIndex === total - 1}
              onClick={() => onNavigate(1)}
            >
              ›
            </button>
          </div>
          <div style={S.actions}>
            <button style={S.keepOldBtn} onClick={() => onKeepOld(currentIndex)}>Keep Old</button>
            <button style={S.keepNewBtn} onClick={() => onKeepNew(currentIndex)}>Keep New</button>
          </div>
        </div>
      </div>
    </div>
  );
}
