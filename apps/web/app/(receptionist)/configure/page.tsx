'use client';

import { useState, useEffect, type FormEvent } from 'react';
import {
  getAgentConfig,
  upsertAgentConfig,
  type TradeType,
  type BusinessHours,
  type DayHours,
  type AgentConfig,
} from '@/lib/receptionist/agent-config';

const TRADE_OPTIONS: { value: TradeType; label: string }[] = [
  { value: 'hvac', label: 'HVAC' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'landscaping', label: 'Landscaping' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'roofing', label: 'Roofing' },
  { value: 'general', label: 'General Contractor' },
];

const DAYS: Array<keyof BusinessHours> = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DEFAULT_HOURS: BusinessHours = {
  monday: { open: '08:00', close: '17:00', enabled: true },
  tuesday: { open: '08:00', close: '17:00', enabled: true },
  wednesday: { open: '08:00', close: '17:00', enabled: true },
  thursday: { open: '08:00', close: '17:00', enabled: true },
  friday: { open: '08:00', close: '17:00', enabled: true },
  saturday: { open: '09:00', close: '14:00', enabled: false },
  sunday: { open: '09:00', close: '14:00', enabled: false },
};

interface FormState {
  tradeType: TradeType;
  businessHours: BusinessHours;
  emergencyPhone: string;
  greetingText: string;
  serviceZipCodes: string;
}

type PageStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  fontSize: '15px',
  color: '#111827',
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'system-ui, sans-serif',
  background: '#fff',
};

export default function ConfigurePage() {
  const [orgId, setOrgId] = useState<string>('');
  const [form, setForm] = useState<FormState>({
    tradeType: 'hvac',
    businessHours: DEFAULT_HOURS,
    emergencyPhone: '',
    greetingText: '',
    serviceZipCodes: '',
  });
  const [status, setStatus] = useState<PageStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    async function bootstrap() {
      try {
        const sessionRes = await fetch('/api/auth/session');
        const sessionData = sessionRes.ok ? await sessionRes.json() : {};
        const resolvedOrgId: string =
          (sessionData?.user?.orgId as string | undefined) ??
          (sessionData?.user?.id as string | undefined) ??
          'default';
        setOrgId(resolvedOrgId);

        const existing: AgentConfig | null = await getAgentConfig(resolvedOrgId);
        if (existing) {
          setForm({
            tradeType: existing.tradeType,
            businessHours: existing.businessHours,
            emergencyPhone: existing.emergencyPhone,
            greetingText: existing.greetingText,
            serviceZipCodes: existing.serviceZipCodes.join(', '),
          });
        }
      } catch (err) {
        // First-time setup or session not available — proceed with defaults
        void err;
      } finally {
        setStatus('idle');
      }
    }
    void bootstrap();
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('saving');
    setErrorMessage('');
    try {
      const serviceZipCodes = form.serviceZipCodes
        .split(/[,\s]+/)
        .map(z => z.trim())
        .filter(z => z.length > 0);

      await upsertAgentConfig({
        orgId,
        tradeType: form.tradeType,
        businessHours: form.businessHours,
        emergencyPhone: form.emergencyPhone,
        greetingText: form.greetingText,
        serviceZipCodes,
      });

      setStatus('saved');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save configuration.';
      setErrorMessage(msg);
      setStatus('error');
    }
  }

  function setTradeType(value: TradeType) {
    setForm(prev => ({ ...prev, tradeType: value }));
  }

  function setDayField(
    day: keyof BusinessHours,
    field: keyof DayHours,
    value: string | boolean,
  ) {
    setForm(prev => ({
      ...prev,
      businessHours: {
        ...prev.businessHours,
        [day]: { ...prev.businessHours[day], [field]: value },
      },
    }));
  }

  if (status === 'loading') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <p style={{ color: '#6b7280', fontSize: '15px' }}>Loading configuration...</p>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: '720px',
        margin: '0 auto',
        padding: '48px 24px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <header style={{ marginBottom: '40px' }}>
        <h1
          style={{
            fontSize: '28px',
            fontWeight: '700',
            color: '#111827',
            margin: '0 0 8px 0',
          }}
        >
          AI Receptionist Setup
        </h1>
        <p style={{ color: '#6b7280', fontSize: '15px', margin: 0 }}>
          Configure how your AI receptionist handles incoming calls for your trade business.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}
      >
        {/* Trade Type */}
        <section>
          <h2
            style={{
              fontSize: '16px',
              fontWeight: '600',
              color: '#374151',
              margin: '0 0 4px 0',
            }}
          >
            Trade Type
          </h2>
          <p style={{ color: '#6b7280', fontSize: '13px', margin: '0 0 14px 0' }}>
            Select your primary trade so the AI routes and handles calls correctly.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '10px',
            }}
          >
            {TRADE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTradeType(opt.value)}
                style={{
                  padding: '12px 16px',
                  border: `2px solid ${form.tradeType === opt.value ? '#2563eb' : '#e5e7eb'}`,
                  borderRadius: '8px',
                  background: form.tradeType === opt.value ? '#eff6ff' : '#fff',
                  color: form.tradeType === opt.value ? '#1d4ed8' : '#374151',
                  fontWeight: form.tradeType === opt.value ? '600' : '400',
                  cursor: 'pointer',
                  fontSize: '14px',
                  textAlign: 'center',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Business Hours */}
        <section>
          <h2
            style={{
              fontSize: '16px',
              fontWeight: '600',
              color: '#374151',
              margin: '0 0 4px 0',
            }}
          >
            Business Hours
          </h2>
          <p style={{ color: '#6b7280', fontSize: '13px', margin: '0 0 14px 0' }}>
            Calls outside these hours trigger the after-hours message and may escalate to your
            emergency line.
          </p>
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            {DAYS.map((day, idx) => {
              const dayData = form.businessHours[day];
              return (
                <div
                  key={day}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '150px 1fr',
                    alignItems: 'center',
                    padding: '12px 16px',
                    background: idx % 2 === 0 ? '#f9fafb' : '#fff',
                    borderBottom:
                      idx < DAYS.length - 1 ? '1px solid #e5e7eb' : 'none',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      fontSize: '14px',
                      color: '#374151',
                      fontWeight: '500',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={dayData.enabled}
                      onChange={e => setDayField(day, 'enabled', e.target.checked)}
                      style={{ width: '15px', height: '15px', cursor: 'pointer' }}
                    />
                    {day.charAt(0).toUpperCase() + day.slice(1)}
                  </label>
                  {dayData.enabled ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="time"
                        value={dayData.open}
                        onChange={e => setDayField(day, 'open', e.target.value)}
                        style={{
                          padding: '5px 8px',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          fontSize: '13px',
                          color: '#374151',
                        }}
                      />
                      <span style={{ color: '#9ca3af', fontSize: '13px' }}>–</span>
                      <input
                        type="time"
                        value={dayData.close}
                        onChange={e => setDayField(day, 'close', e.target.value)}
                        style={{
                          padding: '5px 8px',
                          border: '1px solid #d1d5db',
                          borderRadius: '6px',
                          fontSize: '13px',
                          color: '#374151',
                        }}
                      />
                    </div>
                  ) : (
                    <span
                      style={{
                        color: '#9ca3af',
                        fontSize: '13px',
                        fontStyle: 'italic',
                      }}
                    >
                      Closed
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Emergency Escalation Number */}
        <section>
          <h2
            style={{
              fontSize: '16px',
              fontWeight: '600',
              color: '#374151',
              margin: '0 0 4px 0',
            }}
          >
            Emergency Escalation Number
          </h2>
          <p style={{ color: '#6b7280', fontSize: '13px', margin: '0 0 12px 0' }}>
            Emergency calls (e.g., no heat in winter, gas leak) will be live-transferred to this
            number around the clock.
          </p>
          <input
            type="tel"
            value={form.emergencyPhone}
            onChange={e => setForm(prev => ({ ...prev, emergencyPhone: e.target.value }))}
            placeholder="+1 (555) 000-0000"
            required
            style={inputStyle}
          />
        </section>

        {/* Custom Greeting */}
        <section>
          <h2
            style={{
              fontSize: '16px',
              fontWeight: '600',
              color: '#374151',
              margin: '0 0 4px 0',
            }}
          >
            Custom Greeting
          </h2>
          <p style={{ color: '#6b7280', fontSize: '13px', margin: '0 0 12px 0' }}>
            First words the AI speaks when answering a call. Keep it concise and professional.
          </p>
          <textarea
            value={form.greetingText}
            onChange={e => setForm(prev => ({ ...prev, greetingText: e.target.value }))}
            placeholder="Thank you for calling! This is your AI receptionist. How can I help you today?"
            required
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </section>

        {/* Service Area Zip Codes */}
        <section>
          <h2
            style={{
              fontSize: '16px',
              fontWeight: '600',
              color: '#374151',
              margin: '0 0 4px 0',
            }}
          >
            Service Area Zip Codes
          </h2>
          <p style={{ color: '#6b7280', fontSize: '13px', margin: '0 0 12px 0' }}>
            Comma-separated zip codes. Callers outside this area are informed you may not service
            their location.
          </p>
          <textarea
            value={form.serviceZipCodes}
            onChange={e => setForm(prev => ({ ...prev, serviceZipCodes: e.target.value }))}
            placeholder="90210, 90211, 90212"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </section>

        {/* Status banners */}
        {status === 'error' && (
          <div
            style={{
              padding: '12px 16px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              color: '#b91c1c',
              fontSize: '14px',
            }}
          >
            {errorMessage}
          </div>
        )}
        {status === 'saved' && (
          <div
            style={{
              padding: '12px 16px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '8px',
              color: '#15803d',
              fontSize: '14px',
            }}
          >
            Configuration saved successfully.
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={status === 'saving'}
          style={{
            padding: '13px 24px',
            background: status === 'saving' ? '#93c5fd' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontSize: '15px',
            fontWeight: '600',
            cursor: status === 'saving' ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
          }}
        >
          {status === 'saving' ? 'Saving…' : 'Save Configuration'}
        </button>
      </form>
    </div>
  );
}
