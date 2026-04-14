export default function PDFPreview({ pdfUrl, isCompiling, error, fileName }) {
  function handleDownload() {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = (fileName || 'resume').replace(/\.tex$/, '') + '.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div style={{
      width: '45%',
      borderLeft: '1px solid #2d2d4a',
      display: 'flex',
      flexDirection: 'column',
      background: '#13131f',
    }}>
      <div style={{
        padding: '8px 14px',
        borderBottom: '1px solid #2d2d4a',
        fontSize: 12,
        color: '#666',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span>PDF Preview</span>
        {isCompiling && <span style={{ color: '#fbbf24' }}>⟳ Compiling…</span>}
        {error && <span style={{ color: '#f87171', fontSize: 11 }} title={error}>⚠ Compile error</span>}
        {pdfUrl && (
          <button
            onClick={handleDownload}
            style={{
              marginLeft: 'auto',
              padding: '2px 10px',
              borderRadius: 6,
              border: '1px solid #2d2d4a',
              background: '#1a1a2e',
              color: '#a78bfa',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            ⬇ Download PDF
          </button>
        )}
      </div>

      {pdfUrl ? (
        <iframe
          src={pdfUrl}
          style={{ flex: 1, border: 'none', width: '100%' }}
          title="PDF Preview"
        />
      ) : (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#444',
          gap: 8,
        }}>
          <span style={{ fontSize: 32 }}>📄</span>
          <span style={{ fontSize: 13 }}>
            {isCompiling ? 'Compiling…' : 'Click Compile to preview'}
          </span>
        </div>
      )}
    </div>
  );
}
