import { useSettings } from '../context/SettingsContext';
import { THEMES, FONT_SIZES, LINE_HEIGHTS } from '../utils/constants';

export default function SettingsPanel({ onClose }) {
  const { settings, updateSettings, resetSettings } = useSettings();

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <div className="slide-panel slide-panel--right">
        <div className="panel-header">
          <span className="panel-title">Ajustes de lectura</span>
          <button className="panel-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="panel-body">
          {/* Font Size */}
          <div className="settings-group">
            <div className="settings-label">Tamaño de texto</div>
            <div className="settings-row">
              <button
                className="settings-btn"
                onClick={() => updateSettings({ fontSize: Math.max(FONT_SIZES.min, settings.fontSize - FONT_SIZES.step) })}
                disabled={settings.fontSize <= FONT_SIZES.min}
              >
                A-
              </button>
              <span className="settings-value">{settings.fontSize}px</span>
              <button
                className="settings-btn"
                onClick={() => updateSettings({ fontSize: Math.min(FONT_SIZES.max, settings.fontSize + FONT_SIZES.step) })}
                disabled={settings.fontSize >= FONT_SIZES.max}
              >
                A+
              </button>
            </div>
          </div>

          {/* Line Height */}
          <div className="settings-group">
            <div className="settings-label">Interlineado</div>
            <div className="settings-row">
              <button
                className="settings-btn"
                onClick={() => updateSettings({ lineHeight: Math.max(LINE_HEIGHTS.min, Math.round((settings.lineHeight - LINE_HEIGHTS.step) * 10) / 10) })}
                disabled={settings.lineHeight <= LINE_HEIGHTS.min}
              >
                −
              </button>
              <span className="settings-value">{settings.lineHeight.toFixed(1)}</span>
              <button
                className="settings-btn"
                onClick={() => updateSettings({ lineHeight: Math.min(LINE_HEIGHTS.max, Math.round((settings.lineHeight + LINE_HEIGHTS.step) * 10) / 10) })}
                disabled={settings.lineHeight >= LINE_HEIGHTS.max}
              >
                +
              </button>
            </div>
          </div>

          {/* Theme */}
          <div className="settings-group">
            <div className="settings-label">Tema</div>
            <div className="theme-selector">
              {Object.entries(THEMES).map(([key, theme]) => (
                <button
                  key={key}
                  className={`theme-btn ${settings.theme === key ? 'active' : ''}`}
                  onClick={() => updateSettings({ theme: key })}
                >
                  <div
                    className="theme-preview"
                    style={{
                      background: theme.bg,
                      borderColor: theme.border,
                    }}
                  />
                  {theme.name}
                </button>
              ))}
            </div>
          </div>

          {/* Text Align */}
          <div className="settings-group">
            <div className="settings-label">Alineación</div>
            <div className="align-selector">
              {[{ value: 'left', label: 'Izq.' }, { value: 'justify', label: 'Justif.' }].map((opt) => (
                <button
                  key={opt.value}
                  className={`align-btn ${settings.textAlign === opt.value ? 'active' : ''}`}
                  onClick={() => updateSettings({ textAlign: opt.value })}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    {opt.value === 'left' ? (
                      <><path d="M4 6h16M4 12h10M4 18h14" /></>
                    ) : (
                      <><path d="M4 6h16M4 12h16M4 18h16" /></>
                    )}
                  </svg>
                </button>
              ))}
            </div>
          </div>

          {/* Reset */}
          <div className="settings-group">
            <button className="settings-reset" onClick={resetSettings}>
              Restablecer valores predeterminados
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
